package auth

import (
	"net/mail"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/store"
)

// validEmail accepts a plain address (no display names, no source routes).
func validEmail(s string) bool {
	addr, err := mail.ParseAddress(s)
	return err == nil && addr.Address == s
}

// storeMapError maps storage-layer failures onto the client-facing error model.
func storeMapError(err error) error {
	if err == nil {
		return nil
	}
	if de := domain.AsError(err); de != nil {
		return de
	}
	return store.MapDBError(err)
}
