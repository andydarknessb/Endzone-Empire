import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Container, Paper, Typography, Alert, CircularProgress } from '@mui/material';
import apiClient from '../../api/apiClient';

function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState(token ? 'pending' : 'missing');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    const verify = async () => {
      try {
        await apiClient.post('/api/auth/verify-email', { token });
        setStatus('done');
      } catch (err) {
        setError(err.response?.data?.error || err.message);
        setStatus('failed');
      }
    };
    verify();
  }, [token]);

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Verify Email
        </Typography>
        {status === 'missing' && (
          <Alert severity="error">Missing verification token. Use the link from your email.</Alert>
        )}
        {status === 'pending' && <CircularProgress />}
        {status === 'done' && (
          <>
            <Alert severity="success" sx={{ mb: 2 }}>Email verified. You're all set!</Alert>
            <Link to="/user">Go to your dashboard</Link>
          </>
        )}
        {status === 'failed' && <Alert severity="error">{error}</Alert>}
      </Paper>
    </Container>
  );
}

export default VerifyEmail;
