# HealPlace API Documentation - Mobile (iOS/Android)

**Base URL:** `https://your-api-domain.com` (replace with your actual API domain)

**Last Updated:** February 27, 2026

---

## Table of Contents
- [Authentication Flow](#authentication-flow)
- [Headers](#headers)
- [Endpoints](#endpoints)
  - [Google Sign In](#1-google-sign-in-mobile)
  - [Apple Sign In](#2-apple-sign-in-mobile)
  - [Email OTP - Send](#3-send-otp-email)
  - [Email OTP - Verify](#4-verify-otp)
  - [Complete Onboarding](#5-complete-onboarding)
  - [Refresh Token](#6-refresh-token)
  - [Logout](#7-logout)
  - [Get Current User](#8-get-current-user-me)
  - [Content Library](#content-library)
- [Response Types](#response-types)
- [Error Handling](#error-handling)

---

## Authentication Flow

### Overview
1. User signs in via **Google**, **Apple**, or **Email OTP**
2. Backend returns `accessToken` and `refreshToken`
3. Store both tokens securely on the device
4. Include `accessToken` in `Authorization` header for protected endpoints
5. Use `refreshToken` to get new tokens when `accessToken` expires
6. If `onboarding_required: true`, prompt user to complete onboarding

---

## Headers

### Required for All Requests
```
Content-Type: application/json
```

### Optional (Recommended)
```
X-Device-Id: <unique-device-identifier>
X-Device-Platform: ios | android | watchos | wearos
User-Agent: <your-app-user-agent>
```

### For Protected Endpoints
```
Authorization: Bearer <accessToken>
```

---

## Endpoints

### 1. Google Sign In (Mobile)

**Endpoint:** `POST /auth/google/mobile`

**Headers:**
```
Content-Type: application/json
X-Device-Id: <device-id>          (optional)
X-Device-Platform: ios | android   (optional)
```

**Request Body:**
```json
{
  "idToken": "string (required)"
}
```

**Description:**
Pass the ID token obtained from Google Sign-In SDK.

**Success Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "onboarding_required": false,
  "user_type": "USER",
  "login_method": "GOOGLE"
}
```

**Example:**
```javascript
// Request
POST /auth/google/mobile
Content-Type: application/json
X-Device-Id: ABC123-DEVICE-UUID
X-Device-Platform: ios

{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjY4M..."
}
```

---

### 2. Apple Sign In (Mobile)

**Endpoint:** `POST /auth/apple`

**Headers:**
```
Content-Type: application/json
X-Device-Id: <device-id>          (optional)
X-Device-Platform: ios | android   (optional)
```

**Request Body:**
```json
{
  "identityToken": "string (required)"
}
```

**Description:**
Pass the identity token obtained from Apple Sign In.

**Success Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "onboarding_required": true,
  "user_type": "GUEST",
  "login_method": "APPLE"
}
```

**Example:**
```javascript
// Request
POST /auth/apple
Content-Type: application/json
X-Device-Id: ABC123-DEVICE-UUID
X-Device-Platform: ios

{
  "identityToken": "eyJraWQiOiJlWGF1bm1MIiwiYWxnIjoiUlMyNTYifQ..."
}
```

---

### 3. Send OTP (Email)

**Endpoint:** `POST /auth/otp/send`

**Headers:**
```
Content-Type: application/json
X-Device-Id: <device-id>    (optional)
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
// Request
POST /auth/otp/send
Content-Type: application/json

{
  "email": "user@example.com"
}
```

---

### 4. Verify OTP

**Endpoint:** `POST /auth/otp/verify`

**Headers:**
```
Content-Type: application/json
X-Device-Id: <device-id>          (optional)
X-Device-Platform: ios | android   (optional)
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
Verify the OTP code and authenticate the user.

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

**Example:**
```javascript
// Request
POST /auth/otp/verify
Content-Type: application/json
X-Device-Id: ABC123-DEVICE-UUID
X-Device-Platform: android

{
  "email": "user@example.com",
  "otp": "123456",
  "deviceId": "ABC123-DEVICE-UUID"
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
// Request
PATCH /auth/onboarding
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "John Doe",
  "age": 30
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
{
  "refreshToken": "string (required for mobile)"
}
```

**Description:**
Get a new access token and refresh token pair. Mobile apps must send the refresh token in the request body.

**Success Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Example:**
```javascript
// Request
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Implementation Note:**
Store the new tokens securely and replace the old ones.

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
{
  "refreshToken": "string (required for mobile)"
}
```

**Description:**
Revoke the refresh token and log out the user.

**Success Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

**Example:**
```javascript
// Request
POST /auth/logout
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Implementation Note:**
Clear stored tokens from the device after successful logout.

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
// Request
GET /auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Response Types

### Login/Auth Response
```typescript
{
  accessToken: string
  refreshToken: string
  onboarding_required: boolean
  user_type: "GUEST" | "USER"
  login_method: "GOOGLE" | "APPLE" | "EMAIL_OTP"
}
```

### User Object
```typescript
{
  id: string
  email: string
  name?: string
  age?: number
  user_type: "GUEST" | "USER"
  createdAt: string (ISO 8601)
}
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
| 401 | Unauthorized | Token expired/invalid - refresh or re-login |
| 403 | Forbidden | User doesn't have permission |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Retry or contact support |

### Handling 401 Errors
```javascript
// Pseudo-code
async function makeAuthenticatedRequest(endpoint, options) {
  try {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (response.status === 401) {
      // Try to refresh token
      const newTokens = await refreshTokens();
      
      // Retry original request with new token
      return fetch(endpoint, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${newTokens.accessToken}`
        }
      });
    }
    
    return response;
  } catch (error) {
    // Handle error
  }
}
```

---

## Security Best Practices

### Token Storage
- **iOS:** Use Keychain Services
- **Android:** Use EncryptedSharedPreferences or Android Keystore
- Never store tokens in plain text or UserDefaults/SharedPreferences

### Device ID
- Generate a unique device identifier on first app launch
- Store securely and reuse for all API calls
- Include in `X-Device-Id` header for improved security tracking

### HTTPS Only
- All API calls must use HTTPS in production
- Do not disable certificate validation

---

## Example Implementation (React Native/Expo)

```typescript
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const API_BASE_URL = 'https://your-api-domain.com';

// Store tokens securely
async function storeTokens(accessToken: string, refreshToken: string) {
  await SecureStore.setItemAsync('accessToken', accessToken);
  await SecureStore.setItemAsync('refreshToken', refreshToken);
}

// Get stored tokens
async function getTokens() {
  const accessToken = await SecureStore.getItemAsync('accessToken');
  const refreshToken = await SecureStore.getItemAsync('refreshToken');
  return { accessToken, refreshToken };
}

// Google Sign In
async function googleSignIn(idToken: string, deviceId: string) {
  const response = await fetch(`${API_BASE_URL}/auth/google/mobile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
      'X-Device-Platform': Platform.OS, // 'ios' or 'android'
    },
    body: JSON.stringify({ idToken }),
  });
  
  const data = await response.json();
  
  if (response.ok) {
    await storeTokens(data.accessToken, data.refreshToken);
    
    if (data.onboarding_required) {
      // Navigate to onboarding screen
    } else {
      // Navigate to home screen
    }
  }
  
  return data;
}

// Refresh Token
async function refreshAccessToken() {
  const { refreshToken } = await getTokens();
  
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
  });
  
  const data = await response.json();
  
  if (response.ok) {
    await storeTokens(data.accessToken, data.refreshToken);
  }
  
  return data;
}

// Get Current User
async function getCurrentUser() {
  const { accessToken } = await getTokens();
  
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  
  if (response.status === 401) {
    // Token expired, try to refresh
    await refreshAccessToken();
    // Retry the request
    return getCurrentUser();
  }
  
  return response.json();
}

// Logout
async function logout() {
  const { accessToken, refreshToken } = await getTokens();
  
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ refreshToken }),
  });
  
  // Clear stored tokens
  await SecureStore.deleteItemAsync('accessToken');
  await SecureStore.deleteItemAsync('refreshToken');
}
```

---

## Testing

### Test Credentials
Contact your backend team for test credentials and test environment URL.

### Tools
- **Postman/Insomnia:** Import these endpoints for testing
- **cURL:** Available in examples above

---

---

## Content Library

### 1. List Public Articles/Tips
**Endpoint:** `GET /v2/content`
**Protected:** ✅ Yes
**Query Parameters:**
- `contentType`: `ARTICLE | TIP | FAQ`
- `tags`: `string[]` (optional)
- `page`: `number` (default: 1)
- `limit`: `number` (default: 10)

**Response:** Paginated list of content. Items needing review are hidden.

---

### 2. Get Article Detail
**Endpoint:** `GET /v2/content/:id`
**Protected:** ✅ Yes
**Description:** Fetch full markdown body. Increments view count safely.

---

### 3. Rate Content
**Endpoint:** `POST /v2/content/:id/rate`
**Protected:** ✅ Yes
**Body:** `{ ratingValue: number (1-5) }`
**Description:** Submit or update user rating.

---

## Support

For questions or issues, contact:
- Backend Team: [your-backend-team@email.com]
- Slack Channel: #api-support

---

**Version:** 1.0.0  
**Environment:** Production
