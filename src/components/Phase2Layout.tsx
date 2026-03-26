import { Outlet } from 'react-router-dom'
import LeftSidebar from './LeftSidebar'

export default function Phase2Layout() {
  return (
    <div className="h-svh min-h-0 flex flex-col overflow-hidden md:flex-row bg-canvas text-text-main font-sans">
      <LeftSidebar />
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  )
}

