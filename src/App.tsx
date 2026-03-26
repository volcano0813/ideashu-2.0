import { ActiveAccountProvider } from './contexts/ActiveAccountContext'
import AppRouter from './routes/AppRouter'

export default function App() {
  return (
    <ActiveAccountProvider>
      <AppRouter />
    </ActiveAccountProvider>
  )
}
