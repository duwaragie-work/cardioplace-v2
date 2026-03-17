# HealPlace API Documentation - Mobile (iOS/Android)

**Base URL:** `https://your-api-domain.com` (replace with your actual API domain)

**Auth path prefix:** All auth endpoints use `/api/v2/auth`. Full URL = `{Base URL}/api/v2/auth/...`

**Last Updated:** March 2026

---

## Table of Contents
- [Authentication Flow](#authentication-flow)
- [Headers](#headers)
- [Endpoints](#endpoints)
  - [Guest Login](#1-guest-login)
  - [Google Sign In](#2-google-sign-in-mobile)
  - [Apple Sign In](#3-apple-sign-in-mobile)
  - [Email OTP - Send](#4-send-otp-email)
  - [Email OTP - Verify](#5-verify-otp)
  - [Complete Onboarding](#6-complete-onboarding)
  - [Refresh Token](#7-refresh-token)
  - [Logout](#8-logout)
  - [Get Current User](#9-get-current-user-me)
  - [Content Library](#content-library)
- [Response Types](#response-types)
- [Error Handling](#error-handling)

---

## Authentication Flow

### Overview
1. User signs in via **Guest**, **Google**, **Apple**, or **Email OTP**
2. Backend returns `accessToken`, `refreshToken`, `userId`, `roles`, and `user_type`
3. Store both tokens securely on the device
4. Include `accessToken` in `Authorization` header for protected endpoints
5. Use `refreshToken` to get new tokens when `accessToken` expires
6. If `onboarding_required: true`, prompt user to complete onboarding
7. **Guest:** Send device ID to get tokens without email/sign-in; same response shape as other logins

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

### 1. Guest Login

**Endpoint:** `POST /api/v2/auth/guest`

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
Continue as guest without signing up. Backend finds or creates a user keyed by device ID and returns the same auth response as other logins. Use this when the user taps "Continue as Guest"; then store tokens and go to the main app.

**Success Response (200):**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "userId": "01J...",
  "onboarding_required": false,
  "user_type": "GUEST",
  "roles": ["GUEST"],
  "login_method": "guest",
  "name": null
}
```

**Error (400):** Missing device ID — send `X-Device-Id` header or `deviceId` in body.

**Example:**
```javascript
POST /api/v2/auth/guest
Content-Type: application/json
X-Device-Id: ABC123-DEVICE-UUID

{}
```

---

### 2. Google Sign In (Mobile)

**Endpoint:** `POST /api/v2/auth/google/mobile`

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
  "refreshToken": "...",
  "userId": "01J...",
  "onboarding_required": false,
  "user_type": "REGISTERED_USER",
  "roles": ["REGISTERED_USER"],
  "login_method": "google",
  "name": "John Doe"
}
```

**Example:**
```javascript
// Request
POST /api/v2/auth/google/mobile
Content-Type: application/json
X-Device-Id: ABC123-DEVICE-UUID
X-Device-Platform: ios

{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjY4M..."
}
```

---

### 3. Apple Sign In (Mobile)

**Endpoint:** `POST /api/v2/auth/apple`

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
  "accessToken": "...",
  "refreshToken": "...",
  "userId": "01J...",
  "onboarding_required": true,
  "user_type": "REGISTERED_USER",
  "roles": ["REGISTERED_USER"],
  "login_method": "apple",
  "name": "Jane Doe"
}
```

**Example:**
```javascript
// Request
POST /api/v2/auth/apple
Content-Type: application/json
X-Device-Id: ABC123-DEVICE-UUID
X-Device-Platform: ios

{
  "identityToken": "eyJraWQiOiJlWGF1bm1MIiwiYWxnIjoiUlMyNTYifQ..."
}
```

---

### 4. Send OTP (Email)

**Endpoint:** `POST /api/v2/auth/otp/send`

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

### 5. Verify OTP

**Endpoint:** `POST /api/v2/auth/otp/verify`

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
  "accessToken": "...",
  "refreshToken": "...",
  "userId": "01J...",
  "onboarding_required": true,
  "user_type": "REGISTERED_USER",
  "roles": ["REGISTERED_USER"],
  "login_method": "otp",
  "name": null
}
```

**Example:**
```javascript
// Request
POST /api/v2/auth/otp/verify
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

### 6. Complete Onboarding

**Endpoint:** `POST /api/v2/auth/profile` (submit) or `PATCH /api/v2/auth/profile` (update)

**Protected:** ✅ Yes (requires Authorization header)

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <accessToken>
```

**Request Body (POST for initial onboarding):**
```json
{
  "name": "string (optional)",
  "dateOfBirth": "string ISO date (optional)",
  "menopauseStage": "PERIMENOPAUSE | MENOPAUSE | POSTMENOPAUSE | UNKNOWN (optional)",
  "timezone": "string IANA e.g. Asia/Colombo (optional)"
}
```

**Description:**
Complete or update user profile. Use POST for initial onboarding (sets `onboardingStatus: COMPLETED`). Use PATCH to update later.

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

**Example:**
```javascript
// Request
POST /api/v2/auth/profile
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "John Doe",
  "timezone": "Asia/Colombo"
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
POST /api/v2/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Implementation Note:**
Store the new tokens securely and replace the old ones.

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
POST /api/v2/auth/logout
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Implementation Note:**
Clear stored tokens from the device after successful logout.

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

**Note:** Profile details (name, dateOfBirth, menopauseStage, timezone, etc.) come from `GET /api/v2/auth/profile`.

**Example:**
```javascript
// Request
GET /api/v2/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Response Types

### Login / Auth Response
```typescript
{
  accessToken: string
  refreshToken: string
  userId: string
  onboarding_required: boolean
  user_type: UserRole        // primary role (e.g. roles[0])
  roles: UserRole[]         // full list: GUEST | REGISTERED_USER | VERIFIED_USER | CONTENT_ADMIN | ...
  login_method: 'otp' | 'google' | 'apple' | 'guest'
  name: string | null
}
```

### User Object (GET /me)
```typescript
{
  id: string
  email: string | null
  roles: string[]   // UserRole enum values
}
```

### Profile Object (GET /profile)
```typescript
{
  id: string
  email: string | null
  name: string | null
  dateOfBirth: Date | null
  menopauseStage: string
  timezone: string | null
  onboardingStatus: string
  accountStatus: string
  createdAt: string
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

// Guest login (device ID required)
async function guestLogin(deviceId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v2/auth/guest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
    },
    body: JSON.stringify({}),
  });
  const data = await response.json();
  if (response.ok) {
    await storeTokens(data.accessToken, data.refreshToken);
  }
  return data;
}

// Google Sign In
async function googleSignIn(idToken: string, deviceId: string) {
  const response = await fetch(`${API_BASE_URL}/api/v2/auth/google/mobile`, {
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
  
  const response = await fetch(`${API_BASE_URL}/api/v2/auth/refresh`, {
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
  
  const response = await fetch(`${API_BASE_URL}/api/v2/auth/me`, {
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
  
  await fetch(`${API_BASE_URL}/api/v2/auth/logout`, {
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

### 1. List Public Content

**Endpoint:** `GET /api/v2/content`  
**Protected:** ✅ Yes

**Query Parameters:**
- `contentType`: `ARTICLE | TIP | FAQ` (optional)
- `tags`: `string[]` (optional) — e.g. `?tags=hot-flashes&tags=sleep`
- `page`: `number` (default: 1)
- `limit`: `number` (default: 10)

**Description:**  
Returns paginated list of published content. Items needing review or soft-deleted are hidden.

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

### 2. Get Content Detail

**Endpoint:** `GET /api/v2/content/:id`  
**Protected:** ✅ Yes

**Description:**  
Fetch full content body and metadata. Increments view count safely.

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

### 3. Rate Content

**Endpoint:** `POST /api/v2/content/:id/rate`  
**Protected:** ✅ Yes

**Request Body:**
```json
{
  "ratingValue": 1
}
```
(`ratingValue` must be between 1 and 5.)

**Description:**  
Submit or update the current user’s rating for the content. Also updates the average rating.

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
