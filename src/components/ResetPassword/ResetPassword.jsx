import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Container, Paper, Typography, TextField, Button, Alert } from '@mui/material';
import apiClient from '../../api/apiClient';

function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post('/api/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Reset Password
        </Typography>
        {!token && <Alert severity="error">Missing reset token. Use the link from your email.</Alert>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {done ? (
          <>
            <Alert severity="success" sx={{ mb: 2 }}>
              Password updated! You can now log in.
            </Alert>
            <Link to="/login">Go to login</Link>
          </>
        ) : (
          token && (
            <form onSubmit={handleSubmit}>
              <TextField
                id="reset-password"
                label="New Password"
                type="password"
                fullWidth
                margin="normal"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                helperText="At least 8 characters"
              />
              <TextField
                id="reset-confirm"
                label="Confirm Password"
                type="password"
                fullWidth
                margin="normal"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                error={mismatch}
                helperText={mismatch ? 'Passwords do not match' : ' '}
              />
              <Button
                type="submit"
                variant="contained"
                color="primary"
                disabled={password.length < 8 || password !== confirm || submitting}
                sx={{ mt: 1 }}
              >
                Reset Password
              </Button>
            </form>
          )
        )}
      </Paper>
    </Container>
  );
}

export default ResetPassword;
