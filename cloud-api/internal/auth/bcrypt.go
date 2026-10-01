package auth

import "golang.org/x/crypto/bcrypt"

// bcryptOK verifies a password against a stored bcrypt hash.
func bcryptOK(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// bcryptHashHash produces a bcrypt hash for storage (admin tooling/tests).
func bcryptHashHash(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), err
}

// bcryptGenerate is the signup/recovery seam for bcryptHashHash (swappable in
// tests to trim cost).
var bcryptGenerate = func(password string) (string, error) {
	return bcryptHashHash(password)
}
