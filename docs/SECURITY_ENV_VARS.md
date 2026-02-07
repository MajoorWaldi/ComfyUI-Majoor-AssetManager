# Majoor Assets Manager - Security Model & Environment Variables Guide

## Overview
The Majoor Assets Manager implements a comprehensive security model to protect your system while providing powerful asset management capabilities. This guide covers the security architecture, threat models, and security-related environment variables.

## Security Architecture

### Defense Layers
The Assets Manager employs multiple layers of security:

#### Application Layer Security
- Input validation and sanitization
- Path containment and validation
- File type verification
- Access control mechanisms

#### Network Layer Security
- CSRF protection on state-changing endpoints
- Origin validation for sensitive requests
- Rate limiting on expensive operations
- Secure communication protocols

#### File System Security
- Root containment validation
- Path traversal prevention
- Permission checking
- Symlink handling controls

### Trust Model
- **User Input**: All user input is validated and sanitized
- **File System**: Only allowed directories are accessible
- **External Tools**: Tools run with limited privileges
- **Network**: Requests validated against origin policies

## Authentication & Authorization

### Write access guard (recommended)
ComfyUI is often used locally, but it can be exposed via `--listen`, reverse proxies, or tunnels.
To reduce risk, Majoor blocks destructive/write operations from non-local clients by default.

- **Default behavior (no token configured)**: allow write operations only from loopback clients (`127.0.0.1` / `::1` / `localhost`).
- **Token behavior**: if `MAJOOR_API_TOKEN` (or `MJR_API_TOKEN`) is set, all write operations require it.
  - Send the token via `X-MJR-Token: <token>` or `Authorization: Bearer <token>`.

#### Overrides (use with care)
- `MAJOOR_REQUIRE_AUTH=1` forces token auth even for loopback (requires `MAJOOR_API_TOKEN`).
- `MAJOOR_ALLOW_REMOTE_WRITE=1` allows remote write operations without a token (**unsafe**).

### Client-side token storage
Set the same secret inside ComfyUI's Settings modal at **Security → Majoor: API Token**. The Assets Manager saves it in browser storage and automatically includes both `X-MJR-Token` and `Authorization: Bearer …` on outbound requests, so remote clients always send the expected header without manual tooling. The backend still needs the matching `MAJOOR_API_TOKEN`/`MJR_API_TOKEN` environment variable at startup for write endpoints to accept the secret.

### Safe Mode (default enabled)
Safe Mode adds an explicit opt-in layer for operations that modify files or user metadata.

- `MAJOOR_SAFE_MODE` (default: enabled)  
  - Set `MAJOOR_SAFE_MODE=0` to disable Safe Mode.
- `MAJOOR_ALLOW_WRITE=1`  
  - Allows rating/tags writes while Safe Mode is enabled.
- `MAJOOR_ALLOW_DELETE=1`  
  - Enables asset deletion (disabled by default).
- `MAJOOR_ALLOW_RENAME=1`  
  - Enables asset rename (disabled by default).
- `MAJOOR_ALLOW_OPEN_IN_FOLDER=1`  
  - Enables `/mjr/am/open-in-folder` (disabled by default).

### Access Control
- File access limited to ComfyUI's allowed directories
- No direct access to system files outside allowed paths
- Permission inheritance from ComfyUI's file system access
- No elevation of privileges possible

## CSRF Protection

### Request Validation
All state-changing endpoints require additional validation:

#### XMLHttpRequest Header
- Requests must include `X-Requested-With: XMLHttpRequest`
- Prevents simple form submissions from external sites
- Standard technique for AJAX endpoint protection

#### CSRF Token Alternative
- Alternative validation using `X-CSRF-Token` header
- Provides fallback for different client implementations
- Tokens validated against session state

### Origin Validation
- When `Origin` header is present, it's validated against `Host`
- Prevents cross-origin requests from unauthorized domains
- Protects against certain types of cross-site attacks

## Rate Limiting

### Per-Client Limits
Rate limiting is implemented on expensive endpoints:

#### Affected Endpoints
- Search operations (`/mjr/am/search`)
- Index scanning (`/mjr/am/scan`)
- Metadata extraction (`/mjr/am/metadata`)
- Batch ZIP operations (`/mjr/am/batch-zip`)

#### Limit Configuration
- Implemented in-memory per-client
- Client identity based on IP address
- Configurable thresholds for different operations
- Resets after specified time intervals

#### Trusted Proxy Support
- `X-Forwarded-For` header honored only from trusted proxies
- Controlled by `MAJOOR_TRUSTED_PROXIES` environment variable
- Prevents IP spoofing in proxy environments

## Path Safety & Containment

### Root Validation
All file operations validate root containment:

#### Allowed Roots
- ComfyUI output directory
- ComfyUI input directory  
- Custom roots defined by user
- Collections directory

#### Path Validation Process
1. Normalize the requested path
2. Resolve to absolute path
3. Verify path starts with allowed root
4. Reject if outside allowed boundaries

### Symlink Handling
- Symlinks are handled carefully to prevent directory traversal
- Optional symlink support via `MJR_ALLOW_SYMLINKS` environment variable
- Disabled by default for security
- When enabled, still validates final resolved path

### Path Traversal Prevention
- Input paths are normalized to prevent `../` attacks
- Absolute path resolution ensures final location is verified
- Multiple validation layers prevent bypass attempts

## File Operation Security

### Safe File Operations
- All file operations go through security validation
- Read operations limited to allowed directories
- Write operations limited to index and temporary directories
- Delete operations require additional confirmation

### Batch ZIP Security
- ZIP building streams directly from file handles
- Prevents TOCTOU (Time-of-Check-Time-of-Use) race conditions
- No temporary file copies created during ZIP building
- Automatic cleanup of temporary ZIP files

### File Type Validation
- File types validated before processing
- Dangerous file types blocked from certain operations
- MIME type checking where possible
- Extension validation for security-sensitive operations

## Network Security

### HTTP Security Headers
Applied to Majoor API endpoints only:

#### Content Security Policy
- `Content-Security-Policy: default-src 'none'`
- Prevents execution of injected content
- Applies only to API responses

#### Content Type Options
- `X-Content-Type-Options: nosniff`
- Prevents MIME-type confusion attacks
- Ensures content is treated as declared type

#### Frame Options
- `X-Frame-Options: DENY`
- Prevents embedding in iframes
- Protects against clickjacking

#### Referrer Policy
- `Referrer-Policy: strict-origin-when-cross-origin`
- Limits referrer information leakage
- Balances privacy with functionality

### API Versioning Security
- Versioned routes redirect to canonical endpoints
- `/mjr/am/v1/...` redirects to `/mjr/am/...` using 308
- Maintains security headers across versions
- Preserves method and query parameters

## External Tool Security

### Tool Execution Safety
- External tools (ExifTool, FFprobe) run with limited privileges
- Input validation before passing to external tools
- Timeout enforcement to prevent hanging operations
- Output validation after tool execution

### Path Validation for Tools
- File paths validated before passing to external tools
- No direct shell execution, only tool invocation
- Input sanitization for all tool parameters
- Tool output parsing with validation

### Tool Location Security
- Tools can be specified via environment variables
- Default to system PATH for security
- No arbitrary tool execution possible
- Tool paths validated at startup

## Environment Variable Security

### Secure Configuration
Environment variables provide secure configuration without code changes:

#### Configuration Validation
- Environment variables validated at startup
- Invalid values fall back to defaults safely
- No unsafe defaults used
- Clear error messages for invalid configurations

### Sensitive Information Handling
- No passwords or secrets stored in environment
- File paths validated for security
- No direct system command execution via environment
- Configuration changes logged appropriately

### Trusted Proxy Configuration
- `MAJOOR_TRUSTED_PROXIES` controls proxy trust
- Default: `127.0.0.1,::1` (localhost only)
- Prevents IP spoofing in proxy environments
- Critical for rate limiting effectiveness

## Threat Model

### Identified Threats

#### Information Disclosure
- Unauthorized access to file metadata
- Exposure of file system structure
- Leakage of generation parameters
- **Mitigation**: Path validation, access controls

#### Path Traversal
- Access to files outside allowed directories
- Reading system files or other users' data
- Writing to unauthorized locations
- **Mitigation**: Path containment, normalization

#### Resource Exhaustion
- Denial of service through expensive operations
- Memory exhaustion via large metadata
- Database locking through concurrent operations
- **Mitigation**: Rate limiting, timeouts, resource limits

#### Code Execution
- Arbitrary command execution through file operations
- Injection through file names or paths
- Malicious file content processing
- **Mitigation**: Input validation, sandboxing

#### Cross-Site Attacks
- CSRF attacks on API endpoints
- XSS through metadata injection
- Clickjacking of interface elements
- **Mitigation**: CSRF tokens, security headers

### Attack Vectors

#### Direct API Access
- Unauthorized access to HTTP endpoints
- Brute force attempts on protected endpoints
- **Protection**: Origin validation, rate limiting

#### File System Manipulation
- Creation of malicious file names
- Symlink attacks in custom roots
- **Protection**: Path validation, containment

#### Input Injection
- Malformed metadata in files
- Special characters in file names
- **Protection**: Input sanitization, validation

## Security Monitoring

### Request Logging
- Optional request logging via observability settings
- Logs include client IP, endpoint, and timestamp
- Sensitive data not logged (file contents, metadata)
- Helpful for detecting unusual access patterns

### Error Handling
- Secure error messages that don't leak system information
- Internal errors logged but not exposed to users
- Validation errors provide guidance without revealing internals
- Stack traces hidden from end users

### Audit Trail
- File operations logged with appropriate detail
- Configuration changes tracked where applicable
- Access patterns monitored for anomalies
- Retention policies for security logs

## Security Best Practices

### Deployment Security

#### Network Isolation
- Run ComfyUI behind appropriate firewalls
- Limit network access to trusted users
- Use VPN or other secure access methods
- Monitor network traffic for anomalies

#### File System Permissions
- Run ComfyUI with minimal required privileges
- Restrict file system permissions appropriately
- Regular permission audits
- Separate user accounts for different functions

#### Regular Updates
- Keep Assets Manager updated to latest version
- Update external tools (ExifTool, FFprobe) regularly
- Apply security patches promptly
- Test updates in non-production environments first

### Configuration Security

#### Principle of Least Privilege
- Grant only necessary file system access
- Disable unnecessary features
- Use restrictive default settings
- Regular security configuration reviews

#### Environment Hardening
- Secure environment variable storage
- Validate all configuration inputs
- Use secure defaults where possible
- Regular security configuration audits

### Operational Security

#### Access Control
- Limit access to authorized users
- Regular access reviews
- Session management best practices
- Audit user activities appropriately

#### Monitoring and Detection
- Monitor for unusual access patterns
- Alert on security-relevant events
- Regular security log reviews
- Incident response procedures

## Security-Related Environment Variables

### Trusted Proxy Configuration
- **MAJOOR_TRUSTED_PROXIES**
  - Purpose: IPs/CIDRs allowed to supply `X-Forwarded-For`/`X-Real-IP`
  - Default: `127.0.0.1,::1`
  - Format: Comma-separated IPs or CIDR blocks
  - Security Impact: Controls which proxies can affect rate limiting
  - Example: `MAJOOR_TRUSTED_PROXIES=127.0.0.1,192.168.1.0/24,10.0.0.0/8`

### Symlink Controls
- **MJR_ALLOW_SYMLINKS**
  - Purpose: Allow symlink/junction custom roots
  - Default: `off` (disabled)
  - Options: `on`, `off`, `true`, `false`
  - Security Impact: Controls directory traversal risk
  - Example: `MJR_ALLOW_SYMLINKS=on`

### Database Security
- **MAJOOR_DB_TIMEOUT**
  - Purpose: Database operation timeout
  - Default: 30.0 seconds
  - Security Impact: Prevents resource exhaustion
  - Example: `MAJOOR_DB_TIMEOUT=60.0`

- **MAJOOR_DB_QUERY_TIMEOUT**
  - Purpose: Maximum query execution time
  - Default: 30.0 seconds
  - Security Impact: Prevents long-running queries
  - Example: `MAJOOR_DB_QUERY_TIMEOUT=45.0`

### Resource Limits
- **MAJOOR_MAX_METADATA_JSON_BYTES**
  - Purpose: Maximum metadata JSON size stored in DB/cache
  - Default: 2097152 (2MB)
  - Security Impact: Prevents memory exhaustion
  - Example: `MAJOOR_MAX_METADATA_JSON_BYTES=4194304`

- **MJR_COLLECTION_MAX_ITEMS**
  - Purpose: Max items per collection JSON
  - Default: 50000
  - Security Impact: Prevents resource exhaustion
  - Example: `MJR_COLLECTION_MAX_ITEMS=100000`

### Dependency Management
- **MJR_AM_NO_AUTO_PIP**
  - Purpose: Disable best-effort dependency auto-install on startup
  - Default: Auto-install enabled
  - Security Impact: Controls external package installation
  - Options: `1`, `true`, `yes`, `on` to disable
  - Example: `MJR_AM_NO_AUTO_PIP=1`

## Security Testing

### Self-Assessment Checklist
Regularly verify security configuration:

#### Access Controls
- [ ] File system access limited to intended directories
- [ ] Custom roots validated and secure
- [ ] No unauthorized file access possible

#### Network Security
- [ ] CSRF protection active on state-changing endpoints
- [ ] Rate limiting functioning properly
- [ ] Security headers applied correctly

#### Input Validation
- [ ] Path traversal prevented
- [ ] File type validation working
- [ ] External tool inputs sanitized

### Penetration Testing Considerations
When performing security testing:

#### Authorized Testing Only
- Ensure proper authorization before testing
- Test in isolated environments when possible
- Document and report findings appropriately

#### Testing Areas
- Path traversal attempts
- Input validation bypasses
- Authentication bypasses
- Resource exhaustion attacks
- Cross-site scripting attempts

## Incident Response

### Security Event Classification
- **Low Risk**: Minor configuration issues
- **Medium Risk**: Potential information disclosure
- **High Risk**: System compromise or data breach
- **Critical Risk**: Active exploitation in progress

### Response Procedures
1. Isolate affected systems
2. Document the incident
3. Assess scope and impact
4. Apply immediate mitigations
5. Investigate root cause
6. Implement permanent fixes
7. Communicate appropriately
8. Review and improve procedures

---
*Security Model & Environment Variables Guide Version: 1.0*  
*Last Updated: January 2026*
