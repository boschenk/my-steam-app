import type { SteamDeskApi } from '../shared/types'

declare global {
  interface Window {
    api: SteamDeskApi
  }
}
