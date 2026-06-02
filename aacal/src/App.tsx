import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const Dashboard = React.lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const Editor = React.lazy(() => import('./components/Editor').then(m => ({ default: m.Editor })));
const Achievements = React.lazy(() => import('./components/Achievements').then(m => ({ default: m.Achievements })));
const Onboarding = React.lazy(() => import('./components/Onboarding').then(m => ({ default: m.Onboarding })));

const App: React.FC = () => {
  return (
    <div className="aacal-theme">
      {/* Background Ambient Glows */}
      <div className="glow-container">
        <div className="glow-orb orb-1"></div>
        <div className="glow-orb orb-2"></div>
      </div>

      <React.Suspense fallback={<div className="p-8 text-center text-white">Loading...</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/edit" element={<Editor />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </React.Suspense>
    </div>
  );
};

export default App;
