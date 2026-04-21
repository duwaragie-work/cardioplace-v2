import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/', '/home', '/about', '/contact', '/welcome', '/sign-in', '/auth/callback', '/auth/magic-link']

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001'

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

function isSuperAdmin(token: string): boolean {
  const payload = decodeJwtPayload(token)
  if (!payload) return false
  const roles = payload.roles
  return Array.isArray(roles) && roles.includes('SUPER_ADMIN')
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value
  const path = request.nextUrl.pathname

  const isPublic = PUBLIC_ROUTES.some(
    (r) => path === r || path.startsWith(r + '/'),
  )

  // SUPER_ADMIN users belong on the admin subdomain, not the patient app.
  if (token && isSuperAdmin(token)) {
    return NextResponse.redirect(new URL(path + request.nextUrl.search, ADMIN_URL))
  }

  // Not logged in, trying to access protected route
  if (!token && !isPublic) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Already logged in, trying to access auth pages → redirect to dashboard
  if (token && (path === '/welcome' || path === '/sign-in')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|mp4|pdf)).*)',
  ],
}
