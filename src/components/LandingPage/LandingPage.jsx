import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import './LandingPage.css';

// CUSTOM COMPONENTS
import RegisterForm from '../RegisterForm/RegisterForm';

function LandingPage() {
  const [heading, setHeading] = useState('Welcome');
  const history = useHistory();

  const onLogin = (event) => {
    history.push('/login');
  };

  return (
    <div className="container">
      <h2>{heading}</h2>

      <div className="grid">
        <div className="grid-col grid-col_8">
          <p>
          Welcome to Endzone Empire, the application that turns armchair quarterbacks into legendary 
          league managers! Our mission is to make your fantasy football experience more fun, exciting,
          and competitive than ever before. With our easy-to-use platform, you'll be able to create, join, 
          and manage your own fantasy football leagues with just a few clicks. 
          </p>

          <p>
          Get ready to become a draft day guru as you build your dream team of gridiron greats. Keep 
          track of player performance, strategize your lineup, and cheer on your team as they rack up
          points in head-to-head matchups. Our user-friendly interface, real-time updates, and 
          comprehensive ranking and scoring systems ensure you'll stay engaged and entertained 
          throughout the entire football season.
          </p>

          <p>
          So, gather your friends, family, or co-workers, and embark on an epic journey of fantasy football 
          triumphs and heartbreaks. Are you ready for the challenge? Join Endzone Empire and find out!
           
          </p>
        </div>
        <div className="grid-col grid-col_4">
          <RegisterForm />

          <center>
            <h4>Already a Member?</h4>
            <div style={{ marginTop: '20px' }}></div>
            <button className="btn btn_sizeSm" onClick={onLogin}>
              Login
            </button>
          </center>
        </div>
      </div>
    </div>
  );
}

export default LandingPage;
