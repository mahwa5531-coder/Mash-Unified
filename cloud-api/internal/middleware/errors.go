package middleware

import (
	"encoding/json"
	"net/http"
)

func jsonEncode(w http.ResponseWriter, v any) error {
	return json.NewEncoder(w).Encode(v)
}
