package repos

import "encoding/json"

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

// jsonMarshal encodes JSONB payloads; nil maps encode as SQL NULL ({}::jsonb
// default applies server-side).
func jsonMarshal(v any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}
