package repos

import (
	"errors"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/store"
)

// ErrEmailTaken marks a lost same-email provision race (transient by
// construction: the retry lands on the conflict check or case 1).
var ErrEmailTaken = errors.New("email taken")

func IsEmailTaken(err error) bool { return errors.Is(err, ErrEmailTaken) }

// AsDomain maps repository errors onto the client-facing domain error model.
func AsDomain(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrIdentityConflict):
		return domain.ErrIdentityConflict()
	case errors.Is(err, ErrEmailTaken):
		return domain.ErrValidation("an account with this email already exists")
	default:
		return store.MapDBError(err)
	}
}
