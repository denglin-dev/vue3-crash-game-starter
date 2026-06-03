/** Demo — token available immediately */
export async function waitForGameUserToken(): Promise<string | null> {
  if (import.meta.client) {
    sessionStorage.setItem('Game_User_Token', 'demo-token')
  }
  return 'demo-token'
}
