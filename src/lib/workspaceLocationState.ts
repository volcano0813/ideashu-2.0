/** `navigate('/workspace', { state })` — 灵感库「基于此素材创作」、热点「用这个写」等 */
export type WorkspaceLocationState = {
  autoMessage?: string
  materialImage?: string | null
  sourceMaterialId?: string
  nonce?: string
}
