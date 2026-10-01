// harness_test.go — the shared test rig for the payment service suite.
//
// fakeStore is an in-memory payment.Store whose concurrency semantics
// MIRROR THE SQL (migration 000010) exactly:
//
//   - global mutex ≈ row locks (coarse but strictly stronger — races that
//     pass here would pass in PG too; races that fail here must fail in PG)
//   - conditional transitions ≈ `UPDATE ... WHERE status IN (...)`
//   - maps keyed by the same unique constraints as the migration
//
// If a test needs PG-truth (e.g. to prove the SQL itself), the repo
// integration test against a real database covers that layer.
//
// Scenario files (one concern each): catalog_test.go, checkout_test.go,
// confirm_test.go, webhook_test.go, reconcile_test.go, concurrency_test.go,
// provider_e2e_test.go.
package payment_test

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/payment"
)

type fakeStore struct {
	mu         sync.Mutex
	orders     map[string]*payment.Order        // by id
	byProvider map[string]*payment.Order        // provider|orderID → order
	byIdem     map[string]*payment.Order        // tenant|key → order
	events     map[string]*payment.WebhookEvent // by event id
	ledger     []*payment.LedgerEntry
	balances   map[string]int64
	seq        int
	failNext   atomic.Bool // fault injection
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		orders: map[string]*payment.Order{}, byProvider: map[string]*payment.Order{},
		byIdem: map[string]*payment.Order{}, events: map[string]*payment.WebhookEvent{},
		balances: map[string]int64{},
	}
}

func cloneOrder(o *payment.Order) *payment.Order { cp := *o; return &cp }

func (f *fakeStore) CreateOrder(_ context.Context, o *payment.Order) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failNext.Swap(false) {
		return errors.New("injected storage failure")
	}
	if o.IdempotencyKey != "" {
		if _, ok := f.byIdem[o.TenantID+"|"+o.IdempotencyKey]; ok {
			return payment.ErrOrderExistsIdem
		}
	}
	if _, ok := f.byProvider[o.Provider+"|"+o.ProviderOrderID]; ok {
		return payment.ErrOrderExistsProvider
	}
	f.orders[o.ID] = cloneOrder(o)
	f.byProvider[o.Provider+"|"+o.ProviderOrderID] = o
	if o.IdempotencyKey != "" {
		f.byIdem[o.TenantID+"|"+o.IdempotencyKey] = o
	}
	return nil
}

func (f *fakeStore) OrderByID(_ context.Context, id string) (*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.orders[id]
	if !ok {
		return nil, payment.ErrNotFound
	}
	return cloneOrder(o), nil
}

func (f *fakeStore) OrderByProviderID(_ context.Context, provider, providerOrderID string) (*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.byProvider[provider+"|"+providerOrderID]
	if !ok {
		return nil, payment.ErrNotFound
	}
	return cloneOrder(o), nil
}

func (f *fakeStore) OrderByIdempotencyKey(_ context.Context, tenantID, key string) (*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.byIdem[tenantID+"|"+key]
	if !ok {
		return nil, payment.ErrNotFound
	}
	return cloneOrder(o), nil
}

func (f *fakeStore) ListOrders(_ context.Context, tenantID string, limit int) ([]*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*payment.Order
	for _, o := range f.orders {
		if o.TenantID == tenantID {
			out = append(out, cloneOrder(o))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeStore) ListOpenOrders(_ context.Context, limit int) ([]*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*payment.Order
	for _, o := range f.orders {
		if o.Status == payment.StatusPending || o.Status == payment.StatusAttempted {
			out = append(out, cloneOrder(o))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *fakeStore) MarkAttempted(_ context.Context, orderID, providerPaymentID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.orders[orderID]
	if !ok || payment.Terminal(o.Status) {
		return nil
	}
	if o.Status == payment.StatusPending {
		o.Status = payment.StatusAttempted
	}
	if providerPaymentID != "" && o.ProviderPaymentID == "" {
		o.ProviderPaymentID = providerPaymentID
	}
	return nil
}

// ApplyPaid mirrors the SQL transaction: state guard + ledger unique +
// balance bump, atomically under the store mutex.
func (f *fakeStore) ApplyPaid(_ context.Context, orderID, providerPaymentID string) (bool, *payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.orders[orderID]
	if !ok {
		return false, nil, payment.ErrNotFound
	}
	if o.Status == payment.StatusPaid {
		return false, cloneOrder(o), nil // state guard: no-op replay
	}
	for _, e := range f.ledger { // UNIQUE(order_id, kind) backstop
		if e.OrderID == orderID && e.Kind == payment.LedgerTopup {
			return false, cloneOrder(o), nil
		}
	}
	o.Status = payment.StatusPaid
	if providerPaymentID != "" {
		o.ProviderPaymentID = providerPaymentID
	}
	now := time.Now().UTC()
	o.PaidAt = &now
	f.balances[o.TenantID] += o.Credits
	f.seq++
	f.ledger = append(f.ledger, &payment.LedgerEntry{
		ID: fmt.Sprintf("led_%d", f.seq), TenantID: o.TenantID, OrderID: orderID,
		Kind: payment.LedgerTopup, Credits: o.Credits, BalanceAfter: f.balances[o.TenantID],
		CreatedAt: now,
	})
	return true, cloneOrder(o), nil
}

func (f *fakeStore) ApplyFailed(_ context.Context, orderID, reason string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.orders[orderID]
	if !ok || payment.Terminal(o.Status) {
		return false, nil
	}
	o.Status = payment.StatusFailed
	o.FailureReason = reason
	return true, nil
}

func (f *fakeStore) ApplyExpired(_ context.Context, orderID string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.orders[orderID]
	if !ok || payment.Terminal(o.Status) || o.ExpiresAt.After(time.Now()) {
		return false, nil
	}
	o.Status = payment.StatusExpired
	return true, nil
}

func (f *fakeStore) ExpireStale(_ context.Context, now time.Time) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int64
	for _, o := range f.orders {
		if (o.Status == payment.StatusPending || o.Status == payment.StatusAttempted) && o.ExpiresAt.Before(now) {
			o.Status = payment.StatusExpired
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) RecordWebhookEvent(_ context.Context, ev *payment.WebhookEvent) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, dup := f.events[ev.EventID]; dup {
		return true, nil
	}
	f.events[ev.EventID] = ev
	return false, nil
}

func (f *fakeStore) Balance(_ context.Context, tenantID string) (*payment.Balance, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b := &payment.Balance{TenantID: tenantID, Balance: f.balances[tenantID]}
	for i := len(f.ledger) - 1; i >= 0; i-- {
		if f.ledger[i].TenantID == tenantID {
			b.LastTopupAmount = f.ledger[i].Credits
			t := f.ledger[i].CreatedAt
			b.LastTopupAt = &t
			break
		}
	}
	return b, nil
}

func (f *fakeStore) Ledger(_ context.Context, tenantID string, limit int) ([]*payment.LedgerEntry, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*payment.LedgerEntry
	for i := len(f.ledger) - 1; i >= 0 && len(out) < limit; i-- {
		if f.ledger[i].TenantID == tenantID {
			out = append(out, f.ledger[i])
		}
	}
	return out, nil
}

// ledgerCountForOrder: exactly-once assertion helper.
func (f *fakeStore) ledgerCountForOrder(orderID string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, e := range f.ledger {
		if e.OrderID == orderID {
			n++
		}
	}
	return n
}

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

// budgetLimiter satisfies payment.Admitter with a fixed per-key limit.
type budgetLimiter struct {
	mu    sync.Mutex
	hits  map[string]int
	limit int
}

func (b *budgetLimiter) Admit(_ context.Context, key string, _ time.Duration, limit int, _ string) bool {
	if b.limit != 0 {
		limit = b.limit
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.hits == nil {
		b.hits = map[string]int{}
	}
	b.hits[key]++
	return b.hits[key] <= limit
}

type fixture struct {
	store    *fakeStore
	provider *payment.MockProvider
	svc      *payment.Service
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{store: newFakeStore(), provider: payment.NewMockProvider()}
	f.svc = payment.New(payment.Config{
		Store: f.store, Provider: f.provider,
		Catalog:  mustCatalog(t),
		OrderTTL: 15 * time.Minute, SweepInterval: time.Hour,
		HistoryLimit: 50, CheckoutPerUser: 100, WebhookPerIP: 1000,
	})
	return f
}

func mustCatalog(t *testing.T) *payment.Catalog {
	t.Helper()
	c, err := payment.CatalogFromEnv("")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

const (
	tenantA = "ten_A"
	userA   = "usr_A"
	tenantB = "ten_B"
)

func firstPack(t *testing.T) payment.Pack {
	t.Helper()
	packs := mustCatalog(t).Packs()
	if len(packs) == 0 {
		t.Fatal("empty catalog")
	}
	return packs[0]
}

// mustCheckout: one-line happy-path checkout for scenarios that care about
// what happens AFTER creation.
func mustCheckout(t *testing.T, f *fixture, packID, idemKey string) *payment.Order {
	t.Helper()
	o, err := f.svc.Checkout(context.Background(), tenantA, userA, packID, idemKey)
	if err != nil {
		t.Fatal(err)
	}
	return o
}
