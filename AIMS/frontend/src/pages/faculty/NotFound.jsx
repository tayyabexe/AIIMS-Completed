import { useNavigate } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';
import './NotFound.css';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="notfound-page">
      <div className="notfound-card">
        <div className="notfound-code">404</div>
        <h2>Page not found</h2>
        <p>The page you're looking for doesn't exist or may have been moved.</p>
        <div className="notfound-actions">
          <button className="btn btn-outline" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Go Back
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            <Home size={16} /> Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
