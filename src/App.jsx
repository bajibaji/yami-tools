import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import HubPage from './pages/HubPage.jsx'
import AssetManagerPage from './pages/AssetManagerPage.jsx'

export default function App () {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<HubPage />} />
        <Route path="/asset-manager" element={<AssetManagerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  )
}
