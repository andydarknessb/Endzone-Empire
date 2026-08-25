import React from 'react';

import { useNavigate } from 'react-router-dom';
import { Button } from '@mui/material';
import RegisterForm from '../RegisterForm/RegisterForm';

function RegisterPage() {
  const navigate = useNavigate();

  return (
    <div>
      <RegisterForm />

      <center>
        <Button
          type="button"
          variant="text"
          onClick={() => {
            navigate('/login');
          }}
        >
          Login
        </Button>
      </center>
    </div>
  );
}

export default RegisterPage;
