import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthCtx, useAuthState } from './hooks/useAuth';
import Landing from './pages/Landing';
import Login from './pages/Login';

function App() {
  const auth = useAuthState();

  return (
    <AuthCtx.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthCtx.Provider>
  );
}

export default App;
