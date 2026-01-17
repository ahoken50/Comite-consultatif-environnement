
import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import PresentationPage from './pages/PresentationPage';
import ProjectionPage from './pages/ProjectionPage';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/presentation" replace />} />
        <Route path="/presentation" element={<PresentationPage />} />
        <Route path="/projection" element={<ProjectionPage />} />
        <Route path="*" element={<Navigate to="/presentation" replace />} />
      </Routes>
    </HashRouter>
  );
};

export default App;
