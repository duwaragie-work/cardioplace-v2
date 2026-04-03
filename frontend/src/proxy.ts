import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getJwtRoles } from './lib/jwt-utils'

const PUBLIC_ROUTES = ['/', '/register', '/auth/callback']

export function proxy(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value
  const path = request.nextUrl.pathname

  const isPublic = PUBLIC_ROUTES.some(
    (r) => path === r || path.startsWith(r + '/'),
  )

  // Not logged in → only public pages allowed
  if (!token && !isPublic) {
    return NextResponse.redirect(new URL('/register', request.url))
  }

  if (token) {
    const roles = getJwtRoles(token)

    // Malformed token → clear and redirect
    if (roles === null) {
      const res = NextResponse.redirect(new URL('/register', request.url))
      res.cookies.delete('access_token')
      return res
    }

    const isSuperAdmin = roles.includes('SUPER_ADMIN')

    // Authenticated user on public pages → redirect to appropriate dashboard
    if (path === '/' || path === '/register') {
      const dest = isSuperAdmin ? '/provider/dashboard' : '/dashboard'
      return NextResponse.redirect(new URL(dest, request.url))
    }

    // Non-admin trying to access provider routes → redirect to patient dashboard
    if (path.startsWith('/provider') && !isSuperAdmin) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|mp4|pdf)).*)',
  ],
}
