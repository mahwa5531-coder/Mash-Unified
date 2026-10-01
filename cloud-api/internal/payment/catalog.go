package payment

import (
	"encoding/json"
	"fmt"
	"sort"
)

// Pack is one purchasable credit bundle. Amounts are integer paise; the
// credits a buyer receives are FIXED per pack — no runtime multiplication,
// no rounding, no surprises at audit time.
type Pack struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	AmountPaise int64  `json:"amount_paise"`
	Credits     int64  `json:"credits"`
	Badge       string `json:"badge,omitempty"` // "Best value" etc. (display only)
}

// Catalog bounds (Razorpay per-order limits; ₹1 – ₹1,00,000).
const (
	MinPackAmountPaise = 100
	MaxPackAmountPaise = 10_000_000
	MaxPacks           = 32
)

// DefaultCatalog — deliberately explicit numbers; every pack credits more
// than its rupee price × 10 (the nominal 1 credit = ₹0.10 rate) so larger
// packs carry a visible bonus.
func DefaultCatalog() []Pack {
	return []Pack{
		{ID: "pack_starter", Label: "Starter — ₹500", AmountPaise: 50000, Credits: 5000},
		{ID: "pack_plus", Label: "Plus — ₹1,000", AmountPaise: 100000, Credits: 10500, Badge: "Popular"},
		{ID: "pack_pro", Label: "Pro — ₹2,500", AmountPaise: 250000, Credits: 27500},
		{ID: "pack_scale", Label: "Scale — ₹5,000", AmountPaise: 500000, Credits: 60000, Badge: "Best value"},
	}
}

// Catalog is the validated, immutable set of purchasable packs. Built once
// at boot (config), read concurrently afterwards — never mutated.
type Catalog struct {
	packs []Pack
	byID  map[string]Pack
}

// NewCatalog validates and freezes a pack list.
func NewCatalog(packs []Pack) (*Catalog, error) {
	if len(packs) == 0 {
		return nil, fmt.Errorf("payment: catalog is empty")
	}
	if len(packs) > MaxPacks {
		return nil, fmt.Errorf("payment: catalog has %d packs (max %d)", len(packs), MaxPacks)
	}
	c := &Catalog{byID: make(map[string]Pack, len(packs))}
	for _, p := range packs {
		switch {
		case p.ID == "":
			return nil, fmt.Errorf("payment: pack with empty id")
		case len(p.ID) > 64:
			return nil, fmt.Errorf("payment: pack id %q too long (max 64)", p.ID)
		case p.Label == "":
			return nil, fmt.Errorf("payment: pack %s: empty label", p.ID)
		case p.AmountPaise < MinPackAmountPaise || p.AmountPaise > MaxPackAmountPaise:
			return nil, fmt.Errorf("payment: pack %s: amount %d paise outside [%d, %d]",
				p.ID, p.AmountPaise, MinPackAmountPaise, MaxPackAmountPaise)
		case p.Credits <= 0:
			return nil, fmt.Errorf("payment: pack %s: credits must be positive", p.ID)
		}
		if _, dup := c.byID[p.ID]; dup {
			return nil, fmt.Errorf("payment: duplicate pack id %s", p.ID)
		}
		c.byID[p.ID] = p
		c.packs = append(c.packs, p)
	}
	// Display order: cheapest first, id as tiebreaker (stable JSON output).
	sort.Slice(c.packs, func(i, j int) bool {
		if c.packs[i].AmountPaise != c.packs[j].AmountPaise {
			return c.packs[i].AmountPaise < c.packs[j].AmountPaise
		}
		return c.packs[i].ID < c.packs[j].ID
	})
	return c, nil
}

// CatalogFromEnv returns the default catalog, or the JSON-decoded override
// from NEXAU_PAYMENT_CATALOG_JSON (validated identically — an override that
// fails validation must fail boot, not silently fall back: operators who
// set prices expect them to be live).
func CatalogFromEnv(envJSON string) (*Catalog, error) {
	if envJSON == "" {
		return NewCatalog(DefaultCatalog())
	}
	var packs []Pack
	if err := json.Unmarshal([]byte(envJSON), &packs); err != nil {
		return nil, fmt.Errorf("payment: NEXAU_PAYMENT_CATALOG_JSON: %w", err)
	}
	return NewCatalog(packs)
}

// Get resolves a pack by id.
func (c *Catalog) Get(id string) (Pack, bool) {
	if c == nil {
		return Pack{}, false
	}
	p, ok := c.byID[id]
	return p, ok
}

// Packs returns the display-ordered list.
func (c *Catalog) Packs() []Pack {
	if c == nil {
		return nil
	}
	out := make([]Pack, len(c.packs))
	copy(out, c.packs)
	return out
}
