import React from 'react';
import LoginForm from '../LoginForm/LoginForm';
import { useNavigate } from 'react-router-dom';
import { Button } from '@mui/material';

function LoginPage() {
  const navigate = useNavigate();

  return (
    <div>
      <LoginForm />

      <center>
        <Button
          type="button"
          variant="text"
          onClick={() => {
            navigate('/registration');
          }}
        >
          Register
        </Button>
      </center>
    </div>
  );
}

export default LoginPage;
