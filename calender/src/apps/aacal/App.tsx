import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { Editor } from './components/Editor';
import { Achievements } from './components/Achievements';
import { Onboarding } from './components/Onboarding';

const App: React.FC = () => {
  return (
    <div className="aacal-theme">
      {/* Background Ambient Glows */}
      <div className="glow-container">
        <div className="glow-orb orb-1"></div>
        <div className="glow-orb orb-2"></div>
      </div>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/edit" element={<Editor />} />
        <Route path="/achievements" element={<Achievements />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

export default App;
