import React from 'react';
import { Link } from 'react-router-dom';

const StudentPortal = () => {
  return (
    <Link to="/student-login" className="portal-card student-card">
      <div className="card-top">
        <div className="card-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3L2 8l10 5 10-5-10-5z" stroke="white" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5"
              stroke="white" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M22 8v6" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <span className="card-label">STUDENTS</span>
        <h2 className="card-title">Student Portal</h2>
      </div>
      <div className="card-bottom">
        <p className="card-description">
          Access grades, attendance, fee status, schedules and AI learning tools.
        </p>
        <span className="sign-in-link">
          Sign In <span>→</span>
        </span>
      </div>
    </Link>
  );
};

export default StudentPortal;