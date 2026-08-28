import { Routes, Route, Navigate } from 'react-router-dom'
import HubPage from './pages/HubPage.jsx'
import AssetManagerPage from './pages/AssetManagerPage.jsx'

export default function App () {
  return (
    <Routes>
      <Route path="/" element={<HubPage />} />
      <Route path="/asset-manager" element={<AssetManagerPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
