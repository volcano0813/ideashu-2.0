import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Phase1Layout from '../components/Phase1Layout'
import Phase2Layout from '../components/Phase2Layout'
import WorkspacePage from '../pages/WorkspacePage'
import MaterialBankPage from '../pages/MaterialBankPage'
import HotBoardPage from '../pages/HotBoardPage'
import AccountsPage from '../pages/AccountsPage'
import StyleLearningPage from '../pages/StyleLearningPage'
import KnowledgeBasePage from '../pages/KnowledgeBasePage'
import PendingPublishConfirmPage from '../pages/PendingPublishConfirmPage'
import SettingsPage from '../pages/SettingsPage'
import DataTrackingPage from '../pages/DataTrackingPage'

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Phase1Layout />}>
          <Route path="/" element={<WorkspacePage />} />
          <Route path="/material-bank" element={<MaterialBankPage />} />
          <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
        </Route>

        <Route element={<Phase2Layout />}>
          <Route path="/hot-board" element={<HotBoardPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/style-learning" element={<StyleLearningPage />} />
          <Route path="/pending-publish" element={<PendingPublishConfirmPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/data-tracking" element={<DataTrackingPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

