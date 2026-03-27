import { Outlet } from 'react-router-dom'
import TopNav from './TopNav'

export default function Phase1Layout() {
  return (
    <div className="h-svh min-h-0 flex min-w-0 flex-col overflow-hidden bg-canvas text-text-main font-sans">
      <TopNav />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

