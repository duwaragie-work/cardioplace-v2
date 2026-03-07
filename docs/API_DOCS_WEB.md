# HealPlace API Documentation - Web

**Base URL:** `https://your-api-domain.com` (replace with your actual API domain)

**Last Updated:** February 27, 2026

---

## Table of Contents
- [Authentication Flow](#authentication-flow)
- [Headers](#headers)
- [Endpoints](#endpoints)
  - [Google Sign In (OAuth)](#1-google-sign-in-web-oauth)
  - [Apple Sign In (OAuth)](#2-apple-sign-in-web-oauth)
  - [Email OTP - Send](#3-send-otp-email)
  - [Email OTP - Verify](#4-verify-otp)
  - [Complete Onboarding](#5-complete-onboarding)
  - [Refresh Token](#6-refresh-token)
  - [Logout](#7-logout)
  - [Get Current User](#8-get-current-user-me)
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
1. User signs in via **Google OAuth**, **Apple OAuth**, or **Email OTP**
2. For OAuth flows, user is redirected to provider, then back to your callback URL
3. Backend sets `refreshToken` as **httpOnly cookie** (secure)
4. Backend returns `accessToken` in URL parameters (OAuth) or response body (OTP)
5. Store `accessToken` in memory or sessionStorage
6. Include credentials in requests (cookies sent automatically)
7. If `onboarding_required: true`, redirect to onboarding page

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

### 1. Google Sign In (Web OAuth)

**Step 1: Initiate OAuth**

**Endpoint:** `GET /auth/google`

**Description:**
Redirect user to this endpoint to start Google OAuth flow.

**Example:**
```javascript
// Redirect user to:
window.location.href = 'https://your-api-domain.com/auth/google';
```

**Step 2: Handle Callback**

**Endpoint:** `GET /auth/google/callback` (handled by backend)

**Description:**
Backend handles Google's callback and redirects to your web app with parameters.

**Redirect URL:**
```
https://your-web-app.com/auth/callback?access=<accessToken>&onboarding_required=<boolean>&user_type=<USER|GUEST>&login_method=GOOGLE
```

**URL Parameters:**
- `access`: The access token (JWT)
- `onboarding_required`: Boolean string ("true" or "false")
- `user_type`: "USER" or "GUEST"
- `login_method`: "GOOGLE"

**Example Frontend Handler:**
```javascript
// In your /auth/callback page
const urlParams = new URLSearchParams(window.location.search);
const accessToken = urlParams.get('access');
const onboardingRequired = urlParams.get('onboarding_required') === 'true';
const userType = urlParams.get('user_type');
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

### 2. Apple Sign In (Web OAuth)

**Step 1: Initiate OAuth**

**Endpoint:** `GET /auth/apple/web`

**Description:**
Redirect user to this endpoint to start Apple OAuth flow.

**Example:**
```javascript
// Redirect user to:
window.location.href = 'https://your-api-domain.com/auth/apple/web';
```

**Step 2: Handle Callback**

**Endpoint:** `GET /auth/apple/callback` (handled by backend)

**Description:**
Backend handles Apple's callback and redirects to your web app with parameters.

**Redirect URL:**
```
https://your-web-app.com/auth/callback?access=<accessToken>&onboarding_required=<boolean>&user_type=<USER|GUEST>&login_method=APPLE
```

**URL Parameters:**
Same as Google OAuth (see above)

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

### 3. Send OTP (Email)

**Endpoint:** `POST /auth/otp/send`

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
  const response = await fetch('https://your-api-domain.com/auth/otp/send', {
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

### 4. Verify OTP

**Endpoint:** `POST /auth/otp/verify`

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
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "onboarding_required": true,
  "user_type": "GUEST",
  "login_method": "EMAIL_OTP"
}
```

**Note:** Although `refreshToken` is in the response, it's also set as an httpOnly cookie. For web, rely on the cookie.

**Example:**
```javascript
async function verifyOTP(email, otp) {
  const response = await fetch('https://your-api-domain.com/auth/otp/verify', {
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

### 5. Complete Onboarding

**Endpoint:** `PATCH /auth/onboarding`

**Protected:** ✅ Yes (requires Authorization header)

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <accessToken>
```

**Request Body:**
```json
{
  "name": "string (required)",
  "age": "number (optional, 0-120)"
}
```

**Description:**
Complete user onboarding by providing name and optional age.

**Success Response (200):**
```json
{
  "id": "01JGM7XK8N9P2R3T4V5W6X7Y8Z",
  "name": "John Doe",
  "age": 30,
  "email": "user@example.com",
  "user_type": "USER"
}
```

**Example:**
```javascript
async function completeOnboarding(name, age) {
  const accessToken = sessionStorage.getItem('accessToken');
  
  const response = await fetch('https://your-api-domain.com/auth/onboarding', {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name, age }),
  });
  
  return response.json();
}
```

---

### 6. Refresh Token

**Endpoint:** `POST /auth/refresh`

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
  const response = await fetch('https://your-api-domain.com/auth/refresh', {
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

---

### 7. Logout

**Endpoint:** `POST /auth/logout`

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
  
  const response = await fetch('https://your-api-domain.com/auth/logout', {
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

### 8. Get Current User (Me)

**Endpoint:** `GET /auth/me`

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
  "name": "John Doe",
  "age": 30,
  "user_type": "USER",
  "createdAt": "2026-02-27T10:30:00.000Z"
}
```

**Example:**
```javascript
async function getCurrentUser() {
  const accessToken = sessionStorage.getItem('accessToken');
  
  const response = await fetch('https://your-api-domain.com/auth/me', {
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
      await fetch(`${API_BASE_URL}/auth/logout`, {
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
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
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

    const response = await fetchWithAuth(`${API_BASE_URL}/auth/me`);
    
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
    
    const response = await fetch(`${API_BASE_URL}/auth/otp/send`, {
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
    
    const response = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
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
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const handleAppleLogin = () => {
    window.location.href = `${API_BASE_URL}/auth/apple/web`;
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
**Endpoint:** `GET /v2/content`
**Protected:** ✅ Yes
**Query Parameters:**
- `contentType`: `ARTICLE | TIP | FAQ` (optional)
- `tags`: `string[]` (optional)
- `page`: `number` (default: 1)
- `limit`: `number` (default: 10)

**Description:** Returns paginated list of published content. Automatically filters out items needing review or soft-deleted.

---

#### 2. Get Single Content
**Endpoint:** `GET /v2/content/:id`
**Protected:** ✅ Yes
**Description:** Returns full content body. Increments view count.

---

### Admin Content Endpoints (CONTENT_ADMIN, SUPER_ADMIN)

#### 3. Create Draft
**Endpoint:** `POST /v2/content`
**Request Body:** `CreateContentDto` (title, contentType, body, summary, tags?, references?)
**Status:** `DRAFT`

---

#### 4. Save/Update Draft
**Endpoint:** `PATCH /v2/content/:id`
**Description:** Edits content in `DRAFT`. Creates a new version snapshot.

---

#### 5. Submit for Review
**Endpoint:** `POST /v2/content/:id/submit`
**Description:** Transitions to `IN_REVIEW`. Locks editing.

---

#### 6. Admin Actions (Unpublish / Reopen)
- `POST /v2/content/:id/unpublish`
- `POST /v2/content/:id/reopen` (DRAFT ← UNPUBLISHED)

---

#### 7. Version History & Audit Log
- `GET /v2/content/:id/versions`
- `GET /v2/content/:id/versions/:versionNo`
- `GET /v2/content/:id/audit` (Full event log)

---

#### 8. Super Admin Override
**Endpoint:** `POST /v2/content/:id/publish/:versionNo`
**Description:** Bypasses review gate.

---

### Reviewer Endpoints (CONTENT_APPROVER, SUPER_ADMIN)

#### 9. Submit Review
**Endpoint:** `POST /v2/content/:id/review`
**Body:** `{ reviewType: EDITORIAL|CLINICAL, outcome: APPROVED|REJECTED, notes?: string }`
**Logic:** Rejection resets to `DRAFT`. Dual approval auto-publishes.

---

### Content User Actions

#### 10. Rate Content
**Endpoint:** `POST /v2/content/:id/rate`
**Body:** `{ ratingValue: 1-5 }`
**Description:** Upserts rating and updates average.

---

## Support

For questions or issues, contact:
- Backend Team: [your-backend-team@email.com]
- Slack Channel: #api-support

---

**Version:** 1.0.0  
**Environment:** Production
