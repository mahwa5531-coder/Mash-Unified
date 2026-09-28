// Chat feature — public API.
// Cross-feature consumers must import from '@/features/chat', never deep paths.
export { default as ChatCanvas } from './components/ChatCanvas';
export {
  sessionStore,
  getOrCreateSessionState,
  clearSessionStore,
  isSessionStreaming,
  subscribeToSessionStore,
} from './state/sessionStore';
export type { SessionRuntimeState } from './state/sessionStore';
