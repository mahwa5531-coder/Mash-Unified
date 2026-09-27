# RFC 

 NexAU Cloud  RFC ， RFC 、。

## 

```
{}-{}.md

:
0022-sandbox-networking.md
0015-unified-artifacts.md
```

****:
- ：4 ，（ `0001`, `0022`）
- ：， `-` 
- 

## 

```markdown
# RFC-{}: {}
```

****:
```markdown
# RFC-0022: Sandbox  E2B 
# RFC-0013: Agent Sandbox Manager
```

****:
- （）
- RFC 
- ，

## Front Matter

 RFC （）：

```markdown
- ****: draft | accepted | implementing | implemented | superseded | rejected
- ****: P0 | P1 | P2 | P3
- ****: `tag1`, `tag2`, ...
- ****: service1, service2, ...
- ****: YYYY-MM-DD
- ****: YYYY-MM-DD
```

### 

|  |  |  |
|------|------|--------|
| `draft` | ， |  |
| `accepted` | ， |  |
| `implementing` |  |  |
| `implemented` |  |  |
| `superseded` |  RFC  |  RFC  |
| `rejected` |  |  |

### 

|  |  |  |
|--------|------|------|
| `P0` | ， | 、 |
| `P1` | ， | 、 |
| `P2` | ， | 、 |
| `P3` | ， | nice-to-have |

### 

|  |  |
|------|------|
| `architecture` |  |
| `security` |  |
| `performance` |  |
| `networking` |  |
| `dx` |  |
| `api` | API  |
| `database` |  |
| `ci-cd` | CI/CD  |

## 

### 

```markdown
## 
 RFC 。

## 
- ？
- ？
- ？

## 
### 
。

### 
，：
- API 
- 
- /

## 
### 
|  |  |  |  |
|------|------|------|------|
|  A | ... | ... | / |

### 
。

## 
- [ ] Phase 1: ...
- [ ] Phase 2: ...

## 
。
```

### 

**RFC ，**。：

|  |  |
|----------|------------|
| 、 |  |
| API （、、） |  |
| / | ORM  |
|  |  |
|  |  |
|  |  |

****：

❌ ****（）：
```rust
pub fn init_tracing() {
    let env_filter = EnvFilter::from_default_env()
        .add_directive("info".parse().expect("valid directive"));
    let fmt_layer = fmt::layer().json().with_target(true);
    // ... 50 
}
```

✅ ****（）：
```markdown
 `nexau_cloud_service::init_tracing()` ，：
-  `RUST_LOG` 
-  `NEXAU_LOG_FORMAT`  JSON/Pretty 
-  OpenTelemetry OTLP 
```

****：

- ✅  API （3-5 ）
- ✅ （）
- ✅ 
- ❌ 
- ❌ 
- ❌ 

### 

```markdown
## 
。

## 
|  |  |
|------|------|
| `path/to/file.rs` |  |

## 
- [](url) - 
```

## 

RFC  [Mermaid ](../mermaid-style-guide.md)。

### 

```
🟢 /:        #10B981 / #059669
🟠 /:    #F59E0B / #D97706
🔵 :          #3B82F6 / #2563EB
🔴 /:        #EF4444 / #DC2626
🟣 Docker/:       #8B5CF6 / #7C3AED
🔷 /:         #06B6D4 / #0891B2
🔹 /:     #6366F1 / #4F46E5
🩵 /:       #14B8A6 / #0D9488
⚪ /:         #6B7280 / #4B5563
```

### 

```mermaid
flowchart TB
    subgraph Gateway[""]
        Proxy["sandbox-proxy"]
    end

    subgraph Services[""]
        SM["Sandbox Manager"]
    end

    subgraph Infra[""]
        Redis[("Redis")]
    end

    Proxy --> SM
    SM --> Redis

    style Gateway fill:#E0F2FE,stroke:#06B6D4,stroke-width:2px,color:#0C4A6E
    style Services fill:#D1FAE5,stroke:#10B981,stroke-width:2px,color:#065F46
    style Infra fill:#EDE9FE,stroke:#8B5CF6,stroke-width:2px,color:#5B21B6

    style Proxy fill:#06B6D4,stroke:#0891B2,color:#fff
    style SM fill:#10B981,stroke:#059669,color:#fff
    style Redis fill:#14B8A6,stroke:#0D9488,color:#fff
```

### ASCII （）

 Mermaid ， ASCII ：

```
┌─────────────────────────────────────────┐
│              /              │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│           Nginx (TLS )               │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│           sandbox-proxy                  │
└──────────────────┬──────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   sandbox-a             sandbox-b
```

## 

### Rust 

```rust
/// 
pub async fn example_function(
    param: &str,
) -> Result<Response> {
    // 
    Ok(response)
}
```

### Python 

```python
def example_function(param: str) -> Response:
    """"""
    return response
```

### 

```yaml
service:
  port: 8080
  timeout: 30s
```

## 

### 

```markdown
|  |  |  |  |
|------|------|------|------|
| A |  |  |  |
| B |  |  | **** |
```

### 

```markdown
|  |  |  |
|--------|--------|------|
| `PORT` | `8080` |  |
```

### 

```markdown
|  |  |  |
|------|------|------|
| Phase 1 | ✅ |  |
| Phase 2 | 🚧 |  |
| Phase 3 | ⏳ |  |
```

## 

 RFC ：

- [ ]  (`{}-{}.md`)
- [ ]  (`# RFC-{}: {}`)
- [ ] Front matter （、、、、）
- [ ] （、、、、）
- [ ] 
- [ ] 
- [ ] 
- [ ]  `rfcs/README.md` 

##  RFC

 RFC ：

- [RFC-0010: ](./0010-service-architecture.md) - 
- [RFC-0013: Agent Sandbox Manager](./0013-agent-sandbox-manager.md) - 
- [RFC-0022: Sandbox  E2B ](./0022-sandbox-networking.md) - /

---

_， RFC _