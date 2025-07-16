import React from 'react';
import ReactDOM from 'react-dom/client'; // Note: Using React 18's createRoot
import './index.css'; // Assuming you have an index.css
import App from './App'; // Import your App component
import reportWebVitals from './reportWebVitals'; // For performance metrics

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
