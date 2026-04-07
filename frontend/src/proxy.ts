import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/', '/home', '/about', '/contact', '/welcome', '/sign-in', '/auth/callback']
const PROVIDER_ROUTES = ['/provider']

export function proxy(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value
  const path = request.nextUrl.pathname

  const isPublic = PUBLIC_ROUTES.some(
    (r) => path === r || path.startsWith(r + '/'),
  )

  // Not logged in, trying to access protected route
  if (!token && !isPublic) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Already logged in, trying to access auth pages → redirect to dashboard
  if (token && (path === '/welcome' || path === '/sign-in')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Suppress unused variable warning for PROVIDER_ROUTES (reserved for future role checks)
  void PROVIDER_ROUTES

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|mp4|pdf)).*)',
  ],
}
