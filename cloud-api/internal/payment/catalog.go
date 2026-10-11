package payment

import (
	"encoding/json"
	"fmt"
	"sort"
)

// PlanSKU is one purchasable plan period. Plans only — no individual
// credits are sold. Amounts are integer paise; the activation effect is
// FIXED per SKU (plan_code + period_days): no runtime multiplication, no
// rounding, no surprises at audit time.
type PlanSKU struct {
	ID          string `json:"id"`          // "plan_pro_1m" (client-facing handle)
	Label       string `json:"label"`       // "Pro — ₹1,999 / month" (display only)
	PlanCode    string `json:"plan_code"`   // plans.code the purchase activates
	PeriodDays  int    `json:"period_days"` // days the activation extends
	AmountPaise int64  `json:"amount_paise"`
	Badge       string `json:"badge,omitempty"` // "Best value" etc. (display only)
}

// Catalog bounds (per-order INR limits ₹1 – ₹1,00,000; period 1 day – 10y).
const (
	MinSKUAmountPaise = 100
	MaxSKUAmountPaise = 10_000_000
	MinSKUPeriodDays  = 1
	MaxSKUPeriodDays  = 3660
	MaxSKUs           = 32
)

// DefaultCatalog — the launch pricing (docs/MODELS-AND-PRICING.md §4):
// Pro at ₹1,999/firm/month (₹19,999/year, ~17% off). Every SKU credits
// the tenant with the SAME plan; only the period and price differ.
func DefaultCatalog() []PlanSKU {
	return []PlanSKU{
		{ID: "plan_pro_1m", Label: "Pro — ₹1,999 / month", PlanCode: "pro", PeriodDays: 30, AmountPaise: 199900, Badge: "Popular"},
		{ID: "plan_pro_1y", Label: "Pro — ₹19,999 / year", PlanCode: "pro", PeriodDays: 365, AmountPaise: 1999900, Badge: "Best value"},
	}
}

// Catalog is the validated, immutable set of purchasable plan SKUs. Built
// once at boot (config), read concurrently afterwards — never mutated.
type Catalog struct {
	skus []PlanSKU
	byID map[string]PlanSKU
}

// NewCatalog validates and freezes a SKU list.
func NewCatalog(skus []PlanSKU) (*Catalog, error) {
	if len(skus) == 0 {
		return nil, fmt.Errorf("payment: catalog is empty")
	}
	if len(skus) > MaxSKUs {
		return nil, fmt.Errorf("payment: catalog has %d skus (max %d)", len(skus), MaxSKUs)
	}
	c := &Catalog{byID: make(map[string]PlanSKU, len(skus))}
	for _, s := range skus {
		switch {
		case s.ID == "":
			return nil, fmt.Errorf("payment: sku with empty id")
		case len(s.ID) > 64:
			return nil, fmt.Errorf("payment: sku id %q too long (max 64)", s.ID)
		case s.Label == "":
			return nil, fmt.Errorf("payment: sku %s: empty label", s.ID)
		case s.PlanCode == "":
			return nil, fmt.Errorf("payment: sku %s: plan_code is required (plans only — no credits)", s.ID)
		case s.PeriodDays < MinSKUPeriodDays || s.PeriodDays > MaxSKUPeriodDays:
			return nil, fmt.Errorf("payment: sku %s: period_days %d outside [%d, %d]",
				s.ID, s.PeriodDays, MinSKUPeriodDays, MaxSKUPeriodDays)
		case s.AmountPaise < MinSKUAmountPaise || s.AmountPaise > MaxSKUAmountPaise:
			return nil, fmt.Errorf("payment: sku %s: amount %d paise outside [%d, %d]",
				s.ID, s.AmountPaise, MinSKUAmountPaise, MaxSKUAmountPaise)
		}
		if _, dup := c.byID[s.ID]; dup {
			return nil, fmt.Errorf("payment: duplicate sku id %s", s.ID)
		}
		c.byID[s.ID] = s
		c.skus = append(c.skus, s)
	}
	// Display order: cheapest first, id as tiebreaker (stable JSON output).
	sort.Slice(c.skus, func(i, j int) bool {
		if c.skus[i].AmountPaise != c.skus[j].AmountPaise {
			return c.skus[i].AmountPaise < c.skus[j].AmountPaise
		}
		return c.skus[i].ID < c.skus[j].ID
	})
	return c, nil
}

// CatalogFromEnv returns the default catalog, or the JSON-decoded override
// from NEXAU_PAYMENT_CATALOG_JSON (validated identically — an override that
// fails validation must fail boot, not silently fall back: operators who
// set prices expect them to be live).
//
//	[{"id":"plan_x_1m","label":"X — ₹999 / month","plan_code":"pro",
//	  "period_days":30,"amount_paise":99900}]
func CatalogFromEnv(envJSON string) (*Catalog, error) {
	if envJSON == "" {
		return NewCatalog(DefaultCatalog())
	}
	var skus []PlanSKU
	if err := json.Unmarshal([]byte(envJSON), &skus); err != nil {
		return nil, fmt.Errorf("payment: NEXAU_PAYMENT_CATALOG_JSON: %w", err)
	}
	return NewCatalog(skus)
}

// Get resolves a SKU by id.
func (c *Catalog) Get(id string) (PlanSKU, bool) {
	if c == nil {
		return PlanSKU{}, false
	}
	s, ok := c.byID[id]
	return s, ok
}

// SKUs returns the display-ordered list.
func (c *Catalog) SKUs() []PlanSKU {
	if c == nil {
		return nil
	}
	out := make([]PlanSKU, len(c.skus))
	copy(out, c.skus)
	return out
}
