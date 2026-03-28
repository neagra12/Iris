import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext.jsx';
import NavBar from './components/NavBar.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Scanner from './pages/Scanner.jsx';
import Cart from './pages/Cart.jsx';
import Planner from './pages/Planner.jsx';
import Profile from './pages/Profile.jsx';

function AppRoutes() {
  const { healthProfile } = useApp();

  if (!healthProfile) {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <div className="pb-20">
        <Routes>
          <Route path="/scanner" element={<Scanner />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/onboarding" element={<Navigate to="/scanner" replace />} />
          <Route path="*" element={<Navigate to="/scanner" replace />} />
        </Routes>
      </div>
      <NavBar />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppRoutes />
    </AppProvider>
  );
}
