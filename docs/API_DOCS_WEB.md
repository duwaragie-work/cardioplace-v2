# HealPlace API Documentation - Web

**Base URL:** `https://your-api-domain.com` (replace with your actual API domain)

**Auth path prefix:** All auth endpoints use `/api/v2/auth`. Full URL = `{Base URL}/api/v2/auth/...`

**Last Updated:** March 2026

---

## Table of Contents
- [Authentication Flow](#authentication-flow)
- [Headers](#headers)
- [Endpoints](#endpoints)
  - [Guest Login](#1-guest-login)
  - [Google Sign In (OAuth)](#2-google-sign-in-web-oauth)
  - [Apple Sign In (OAuth)](#3-apple-sign-in-web-oauth)
  - [Email OTP - Send](#4-send-otp-email)
  - [Email OTP - Verify](#5-verify-otp)
  - [Profile / Onboarding](#6-profile--onboarding)
  - [Refresh Token](#7-refresh-token)
  - [Logout](#8-logout)
  - [Get Current User](#9-get-current-user-me)
  - [Content Library](#content-library)
    - [Public Endpoints](#public-content-endpoints)
    - [Admin Endpoints](#admin-content-endpoints)
    - [Reviewer Endpoints](#reviewer-content-endpoints)
    - [User Actions](#content-user-actions)
- [Cookie Handling](#cookie-handling)
- [Error Handling](#error-handling)

---

## Authentication Flow

### Overview for Web
1. User signs in via **Guest**, **Google OAuth**, **Apple OAuth**, or **Email OTP**
2. For OAuth flows, user is redirected to provider, then back to your callback URL
3. Backend sets `refreshToken` as **httpOnly cookie** (secure)
4. Backend returns `accessToken` in URL parameters (OAuth) or response body (OTP / Guest)
5. Store `accessToken` in memory or sessionStorage
6. Include credentials in requests (cookies sent automatically)
7. If `onboarding_required: true`, redirect to onboarding page
8. **Guest:** Call `POST /api/v2/auth/guest` with `X-Device-Id`; store tokens and go to main app (no redirect)

### Key Differences from Mobile
- **Refresh token** is stored in httpOnly cookie (not in response body)
- **OAuth flows** use redirects instead of SDK tokens
- **Cookies** are sent automatically with `credentials: 'include'`

---

## Headers

### Required for All Requests
```
Content-Type: application/json
```

### For Protected Endpoints
```
Authorization: Bearer <accessToken>
```

### Fetch Requests Must Include
```javascript
{
  credentials: 'include', // Sends cookies with request
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <accessToken>' // for protected routes
  }
}
```

---

## Endpoints

### 1. Guest Login

**Endpoint:** `POST /api/v2/auth/guest`  
**Protected:** ❌ No

**Headers:**
```
Content-Type: application/json
X-Device-Id: <device-id>    (required — or send in body as deviceId)
```

**Request Body (optional):**
```json
{
  "deviceId": "string (optional if X-Device-Id header is set)"
}
```

**Description:**  
Continue as guest without signing up. Backend finds or creates a user keyed by device ID and returns the standard auth response. Backend also sets the refresh token as an httpOnly cookie.

**Success Response (200):**
```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "userId": "string",
  "onboarding_required": false,
  "roles": ["GUEST"],
  "login_method": "guest",
  "name": null
}
```

**Example:**
```javascript
const response = await fetch('https://your-api-domain.com/api/v2/auth/guest', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'X-Device-Id': getOrCreateDeviceId(),
  },
  body: JSON.stringify({}),
});
const data = await response.json();
if (response.ok) {
  sessionStorage.setItem('accessToken', data.accessToken);
  window.location.href = '/home';
}
```

---

### 2. Google Sign In (Web OAuth)

**Step 1: Initiate OAuth**

**Endpoint:** `GET /api/v2/auth/google`

**Description:**
Redirect user to this endpoint to start Google OAuth flow.

**Example:**
```javascript
// Redirect user to:
window.location.href = 'https://your-api-domain.com/api/v2/auth/google';
```

**Step 2: Handle Callback**

**Endpoint:** `GET /api/v2/auth/google/callback` (handled by backend)

**Redirect URL:**
```
https://your-web-app.com/auth/callback?access=<accessToken>&onboarding_required=<boolean>&login_method=google
```

**URL Parameters:**
- `access`: The access token (JWT)
- `onboarding_required`: Boolean string ("true" or "false")
- `login_method`: "google"

**Example Frontend Handler:**
```javascript
// In your /auth/callback page
const urlParams = new URLSearchParams(window.location.search);
const accessToken = urlParams.get('access');
const onboardingRequired = urlParams.get('onboarding_required') === 'true';
const loginMethod = urlParams.get('login_method');

// Store access token (sessionStorage or memory)
sessionStorage.setItem('accessToken', accessToken);

// Note: refreshToken is already set as httpOnly cookie by backend

if (onboardingRequired) {
  // Redirect to onboarding page
  window.location.href = '/onboarding';
} else {
  // Redirect to home page
  window.location.href = '/home';
}
```

---

### 3. Apple Sign In (Web OAuth)

**Step 1: Initiate OAuth**

**Endpoint:** `GET /api/v2/auth/apple/web`

**Example:**
```javascript
window.location.href = 'https://your-api-domain.com/api/v2/auth/apple/web';
```

**Step 2: Handle Callback**

**Endpoint:** `GET /api/v2/auth/apple/callback`

**Redirect URL:**
```
https://your-web-app.com/auth/callback?access=<accessToken>&onboarding_required=<boolean>&login_method=apple
```

**Example Frontend Handler:**
```javascript
// Same as Google OAuth handler
const urlParams = new URLSearchParams(window.location.search);
const accessToken = urlParams.get('access');
const onboardingRequired = urlParams.get('onboarding_required') === 'true';

sessionStorage.setItem('accessToken', accessToken);

if (onboardingRequired) {
  window.location.href = '/onboarding';
} else {
  window.location.href = '/home';
}
```

---

### 4. Send OTP (Email)

**Endpoint:** `POST /api/v2/auth/otp/send`

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "string (required)"
}
```

**Description:**
Request an OTP code to be sent to the user's email address.

**Success Response (200):**
```json
{
  "message": "OTP sent successfully",
  "email": "user@example.com"
}
```

**Example:**
```javascript
async function sendOTP(email) {
  const response = await fetch('https://your-api-domain.com/api/v2/auth/otp/send', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  
  return response.json();
}
```

---

### 5. Verify OTP

**Endpoint:** `POST /api/v2/auth/otp/verify`

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "string (required)",
  "otp": "string (required)",
  "deviceId": "string (optional)"
}
```

**Description:**
Verify the OTP code and authenticate the user. Backend sets refresh token cookie automatically.

**Success Response (200):**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "userId": "01J...",
  "onboarding_required": true,
  "roles": ["REGISTERED_USER"],
  "login_method": "otp",
  "name": null
}
```

**Note:** Although `refreshToken` is in the response, it's also set as an httpOnly cookie. For web, rely on the cookie.

**Example:**
```javascript
async function verifyOTP(email, otp) {
  const response = await fetch('https://your-api-domain.com/api/v2/auth/otp/verify', {
    method: 'POST',
    credentials: 'include', // Important for cookies
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, otp }),
  });
  
  const data = await response.json();
  
  if (response.ok) {
    // Store access token
    sessionStorage.setItem('accessToken', data.accessToken);
    
    // Refresh token is already set as cookie
    
    if (data.onboarding_required) {
      window.location.href = '/onboarding';
    } else {
      window.location.href = '/home';
    }
  }
  
  return data;
}
```

---

### 6. Profile / Onboarding

**Endpoints:**
- `GET /api/v2/auth/profile` — Fetch current user profile  
- `POST /api/v2/auth/profile` — Submit initial onboarding (sets `onboardingStatus: COMPLETED`)  
- `PATCH /api/v2/auth/profile` — Update profile later

**Protected:** ✅ Yes

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <accessToken>
```

**Request Body (POST for initial onboarding / PATCH for update):**
```json
{
  "name": "string (optional)",
  "dateOfBirth": "string ISO date (optional)",
  "menopauseStage": "PERIMENOPAUSE | MENOPAUSE | POSTMENOPAUSE | UNKNOWN (optional)",
  "timezone": "string IANA e.g. Asia/Colombo (optional)"
}
```

**Success Response (200):**
```json
{
  "message": "Profile saved",
  "name": "John Doe",
  "dateOfBirth": "1990-01-15T00:00:00.000Z",
  "menopauseStage": "UNKNOWN",
  "timezone": "Asia/Colombo",
  "onboardingStatus": "COMPLETED"
}
```

**Success Response (200) – GET /api/v2/auth/profile (Phase 1 payload):**

```json
{
  "email": "user@example.com",
  "name": "Jane Doe",
  "roles": ["REGISTERED_USER"],
  "emailVerified": true,
  "accountStatus": "active",
  "createdAt": "2025-01-01T12:34:56.000Z",
  "dateOfBirth": "1990-01-15",
  "menopauseStage": "PERIMENOPAUSE",
  "timezone": "Asia/Colombo",
  "onboardingStatus": "COMPLETED"
}
```

**Example:**
```javascript
async function completeOnboarding(name, timezone) {
  const accessToken = sessionStorage.getItem('accessToken');
  const response = await fetch('https://your-api-domain.com/api/v2/auth/profile', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name, timezone }),
  });
  return response.json();
}
```

---

### 7. Refresh Token

**Endpoint:** `POST /api/v2/auth/refresh`

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{}
```

**Description:**
Get a new access token. The refresh token is read from the httpOnly cookie automatically. Backend sets new refresh token cookie.

**Success Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Note:** `refreshToken` in response is redundant for web; it's already set as cookie.

**Example:**
```javascript
async function refreshToken() {
  const response = await fetch('https://your-api-domain.com/api/v2/auth/refresh', {
    method: 'POST',
    credentials: 'include', // Sends refresh token cookie
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  
  const data = await response.json();
  
  if (response.ok) {
    // Store new access token
    sessionStorage.setItem('accessToken', data.accessToken);
    // New refresh token is already set as cookie
  }
  
  return data;
}
```

**Automatic Refresh on 401:**
```javascript
async function fetchWithAuth(url, options = {}) {
  const accessToken = sessionStorage.getItem('accessToken');
  
  const response = await fetch(url, {
    ...options,
  credentials: 'include',
  headers: {
    ...options.headers,
    'Authorization': `Bearer ${accessToken}`,
  },
});

  // If token expired, refresh and retry
  if (response.status === 401) {
    const refreshResponse = await refreshToken();
    
    if (refreshResponse.accessToken) {
      // Retry original request with new token
      return fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${refreshResponse.accessToken}`,
        },
      });
    }
  }
  
  return response;
}
```

**Note:** Use `/api/v2/auth/*` for all auth endpoints (e.g. `${API_BASE_URL}/api/v2/auth/me`).

---

### 8. Logout

**Endpoint:** `POST /api/v2/auth/logout`

**Protected:** ✅ Yes (requires Authorization header)

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <accessToken>
```

**Request Body:**
```json
{}
```

**Description:**
Revoke the refresh token and clear the cookie. Backend clears the refresh token cookie.

**Success Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

**Example:**
```javascript
async function logout() {
  const accessToken = sessionStorage.getItem('accessToken');
  
  const response = await fetch('https://your-api-domain.com/api/v2/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({}),
  });
  
  // Clear local storage
  sessionStorage.removeItem('accessToken');
  
  // Redirect to login
  window.location.href = '/login';
  
  return response.json();
}
```

---

### 9. Get Current User (Me)

**Endpoint:** `GET /api/v2/auth/me`

**Protected:** ✅ Yes (requires Authorization header)

**Headers:**
```
Authorization: Bearer <accessToken>
```

**Success Response (200):**
```json
{
  "id": "01JGM7XK8N9P2R3T4V5W6X7Y8Z",
  "email": "user@example.com",
  "roles": ["REGISTERED_USER"]
}
```

**Note:** Full profile (name, dateOfBirth, menopauseStage, timezone) from `GET /api/v2/auth/profile`.

**Example:**
```javascript
async function getCurrentUser() {
  const accessToken = sessionStorage.getItem('accessToken');
  
  const response = await fetch('https://your-api-domain.com/api/v2/auth/me', {
    credentials: 'include',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  
  if (response.status === 401) {
    // Token expired, refresh and retry
    await refreshToken();
    return getCurrentUser();
  }
  
  return response.json();
}
```

---

## Cookie Handling

### Refresh Token Cookie

**Cookie Name:** `refresh_token`

**Properties:**
- `httpOnly`: true (JavaScript cannot access it)
- `secure`: true (in production, HTTPS only)
- `sameSite`: 'lax' or 'strict' (configured by backend)
- `maxAge`: 30 days

### CORS Configuration

Your backend must have proper CORS settings for cookies to work:

```javascript
// Backend CORS config (for reference, not frontend code)
{
  origin: 'https://your-web-app.com',
  credentials: true
}
```

### Frontend Requirements

Always include `credentials: 'include'` in fetch requests:

```javascript
fetch('https://your-api-domain.com/auth/me', {
  credentials: 'include', // ← Important!
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
```

---

## Error Handling

### Error Response Format
```json
{
  "statusCode": 400,
  "message": "Error description",
  "error": "Bad Request"
}
```

### Common Status Codes

| Code | Description | Action |
|------|-------------|--------|
| 200 | Success | Continue with response data |
| 400 | Bad Request | Check request body format |
| 401 | Unauthorized | Token expired - refresh token |
| 403 | Forbidden | User doesn't have permission |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Retry or contact support |

### Handling 401 Errors
```javascript
async function handleAuthError(response) {
  if (response.status === 401) {
    // Try to refresh token
    const refreshResponse = await refreshToken();
    
    if (refreshResponse.accessToken) {
      // Token refreshed successfully
      return true;
    } else {
      // Refresh failed, redirect to login
      sessionStorage.removeItem('accessToken');
      window.location.href = '/login';
      return false;
    }
  }
}
```

---

## Security Best Practices

### Token Storage
- **Access Token:** Store in `sessionStorage` or memory (not localStorage)
- **Refresh Token:** Handled as httpOnly cookie (more secure)

### CSRF Protection
- Backend sets `sameSite` cookie attribute
- Consider implementing CSRF tokens for state-changing operations

### HTTPS Only
- All API calls must use HTTPS in production
- Cookies won't be sent over HTTP in production (due to `secure` flag)

### Content Security Policy
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; connect-src 'self' https://your-api-domain.com">
```

---

## Example Implementation (React)

### Auth Context Provider

```typescript
import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  login: (token: string) => void;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }) {
  const [accessToken, setAccessToken] = useState<string | null>(
    sessionStorage.getItem('accessToken')
  );
  const [user, setUser] = useState<User | null>(null);

  const API_BASE_URL = 'https://your-api-domain.com';

  const login = (token: string) => {
    setAccessToken(token);
    sessionStorage.setItem('accessToken', token);
  };

  const logout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/v2/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });
    } finally {
      setAccessToken(null);
      setUser(null);
      sessionStorage.removeItem('accessToken');
      window.location.href = '/login';
    }
  };

  const refreshToken = async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v2/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = await response.json();
        login(data.accessToken);
        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }
    
    return false;
  };

  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (response.status === 401) {
      const refreshed = await refreshToken();
      if (refreshed) {
        // Retry with new token
        return fetch(url, {
          ...options,
          credentials: 'include',
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${sessionStorage.getItem('accessToken')}`,
          },
        });
      } else {
        await logout();
      }
    }

    return response;
  };

  const getCurrentUser = async () => {
    if (!accessToken) return;

    const response = await fetchWithAuth(`${API_BASE_URL}/api/v2/auth/me`);
    
    if (response.ok) {
      const userData = await response.json();
      setUser(userData);
    }
  };

  useEffect(() => {
    if (accessToken) {
      getCurrentUser();
    }
  }, [accessToken]);

  return (
    <AuthContext.Provider value={{ user, accessToken, login, logout, refreshToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

### Login Page Component

```typescript
import React, { useState } from 'react';
import { useAuth } from './AuthContext';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const { login } = useAuth();

  const API_BASE_URL = 'https://your-api-domain.com';

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const response = await fetch(`${API_BASE_URL}/api/v2/auth/otp/send`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (response.ok) {
      setStep('otp');
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const response = await fetch(`${API_BASE_URL}/api/v2/auth/otp/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, otp }),
    });

    if (response.ok) {
      const data = await response.json();
      login(data.accessToken);
      
      if (data.onboarding_required) {
        window.location.href = '/onboarding';
      } else {
        window.location.href = '/home';
      }
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE_URL}/api/v2/auth/google`;
  };

  const handleAppleLogin = () => {
    window.location.href = `${API_BASE_URL}/api/v2/auth/apple/web`;
  };

  return (
    <div>
      <h1>Login</h1>
      
      {step === 'email' ? (
        <form onSubmit={handleSendOTP}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit">Send OTP</button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOTP}>
          <input
            type="text"
            placeholder="Enter OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            required
          />
          <button type="submit">Verify OTP</button>
        </form>
      )}

      <hr />
      
      <button onClick={handleGoogleLogin}>Sign in with Google</button>
      <button onClick={handleAppleLogin}>Sign in with Apple</button>
    </div>
  );
}
```

### OAuth Callback Handler

```typescript
import { useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const accessToken = searchParams.get('access');
    const onboardingRequired = searchParams.get('onboarding_required') === 'true';

    if (accessToken) {
      login(accessToken);
      
      if (onboardingRequired) {
        navigate('/onboarding');
      } else {
        navigate('/home');
      }
    } else {
      navigate('/login');
    }
  }, [searchParams, login, navigate]);

  return <div>Loading...</div>;
}
```

---

## Testing

### Browser Developer Tools
1. Open DevTools → Network tab
2. Check request headers include `Authorization: Bearer ...`
3. Check cookies include `refresh_token`

### Test OAuth Locally
If testing OAuth locally, you need to:
1. Configure OAuth redirect URIs to include `http://localhost:3000`
2. Ensure backend `WEB_APP_URL` points to your local dev server

---

---

## Content Library

### Public Content Endpoints

#### 1. List Public Content

**Endpoint:** `GET /api/v2/content`  
**Protected:** ✅ Yes

**Query Parameters:**
- `contentType`: `ARTICLE | TIP | FAQ` (optional)
- `tags`: `string[]` (optional) — e.g. `?tags=hot-flashes&tags=sleep`
- `page`: `number` (default: 1)
- `limit`: `number` (default: 10)

**Description:**  
Returns a paginated list of published content. Automatically filters out items needing review or soft-deleted.

**Success Response (200) – Example:**
```json
{
  "items": [
    {
      "id": "string",
      "title": "string",
      "contentType": "ARTICLE",
      "summary": "string",
      "tags": ["string"],
      "publishedAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 10,
  "total": 42
}
```

---

#### 2. Get Single Content

**Endpoint:** `GET /api/v2/content/:id`  
**Protected:** ✅ Yes

**Description:**  
Returns full content body and metadata. Increments view count.

**Success Response (200) – Example:**
```json
{
  "id": "string",
  "title": "string",
  "contentType": "ARTICLE",
  "summary": "string",
  "body": "string",
  "tags": ["string"],
  "publishedAt": "2025-01-01T00:00:00.000Z",
  "viewCount": 123,
  "averageRating": 4.5
}
```

---

### Admin Content Endpoints (CONTENT_ADMIN, SUPER_ADMIN)

#### 3. Create Draft

**Endpoint:** `POST /api/v2/content`  
**Protected:** ✅ Yes

**Request Body (CreateContentDto):**
```json
{
  "title": "string",
  "contentType": "ARTICLE | TIP | FAQ",
  "body": "string",
  "summary": "string",
  "tags": ["string"],
  "references": ["string"]
}
```

**Success Response (201) – Example:**
```json
{
  "id": "string",
  "status": "DRAFT"
}
```

---

#### 4. Save/Update Draft

**Endpoint:** `PATCH /api/v2/content/:id`  
**Protected:** ✅ Yes

**Description:**  
Edits content while in `DRAFT` state and creates a new version snapshot.

**Request Body (partial, same shape as create):**
```json
{
  "title": "string (optional)",
  "contentType": "ARTICLE | TIP | FAQ (optional)",
  "body": "string (optional)",
  "summary": "string (optional)",
  "tags": ["string"],
  "references": ["string"]
}
```

---

#### 5. Submit for Review

**Endpoint:** `POST /api/v2/content/:id/submit`  
**Protected:** ✅ Yes

**Description:**  
Transitions content to `IN_REVIEW` and locks editing.

**Request Body:**
```json
{}
```

**Success Response (200) – Example:**
```json
{
  "id": "string",
  "status": "IN_REVIEW"
}
```

---

#### 6. Admin Actions (Unpublish / Reopen)

**Endpoints:**
- `POST /api/v2/content/:id/unpublish`
- `POST /api/v2/content/:id/reopen` (DRAFT ← UNPUBLISHED)

**Request Body (both):**
```json
{}
```

**Description:**  
Unpublish removes content from public list; reopen moves `UNPUBLISHED` back to `DRAFT`.

---

#### 7. Version History & Audit Log

**Endpoints:**
- `GET /api/v2/content/:id/versions`
- `GET /api/v2/content/:id/versions/:versionNo`
- `GET /api/v2/content/:id/audit`

**Success Response – Examples:**

`GET /:id/versions`:
```json
[
  {
    "versionNo": 1,
    "editor": "user-id",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

`GET /:id/versions/:versionNo`:
```json
{
  "versionNo": 2,
  "title": "string",
  "body": "string",
  "summary": "string",
  "tags": ["string"],
  "createdAt": "2025-01-02T00:00:00.000Z"
}
```

---

#### 8. Super Admin Override

**Endpoint:** `POST /api/v2/content/:id/publish/:versionNo`  
**Roles:** `SUPER_ADMIN`

**Request Body:**
```json
{}
```

**Description:**  
Bypasses review gate and force-publishes a specific version.

**Success Response (200) – Example:**
```json
{
  "id": "string",
  "status": "PUBLISHED",
  "publishedVersion": 3
}
```

---

### Reviewer Endpoints (CONTENT_APPROVER, SUPER_ADMIN)

#### 9. Submit Review

**Endpoint:** `POST /api/v2/content/:id/review`  
**Protected:** ✅ Yes

**Request Body:**
```json
{
  "reviewType": "EDITORIAL" | "CLINICAL",
  "outcome": "APPROVED" | "REJECTED",
  "notes": "string (optional)"
}
```

**Description:**  
Rejection resets item to `DRAFT`. Dual approval (editorial + clinical) auto-publishes.

---

### Content User Actions

#### 10. Rate Content

**Endpoint:** `POST /api/v2/content/:id/rate`  
**Protected:** ✅ Yes

**Request Body:**
```json
{
  "ratingValue": 1
}
```
(`ratingValue` must be between 1 and 5.)

**Success Response (200) – Example:**
```json
{
  "id": "string",
  "averageRating": 4.3,
  "userRating": 1
}
```

---

## Support

For questions or issues, contact:
- Backend Team: [your-backend-team@email.com]
- Slack Channel: #api-support

---

**Version:** 1.0.0  
**Environment:** Production
