export class RefreshDto {
  // Mobile clients send the refresh token in the request body.
  // Web clients send it as an httpOnly cookie instead.
  refreshToken?: string
}
