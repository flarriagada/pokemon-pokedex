import { useEffect, useRef, useState } from 'react'
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'
import { getGoogleAuthConfig, loginWithGoogle, getCurrentUser, logoutFromPokedex } from '../services/authService'
import './GoogleLoginButton.css'
import { useNavigate } from 'react-router'

function GoogleLoginButton({ texts, language }) {
  const [clientId, setClientId] = useState('')
  const [isLoadingConfig, setIsLoadingConfig] = useState(true)
  const [scriptStatus, setScriptStatus] = useState('loading')
  const [verificationStatus, setVerificationStatus] = useState('idle')
  const [message, setMessage] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const verificationController = useRef(null)
  const [sessionUser, setSessionUser] = useState(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const controller = new AbortController()

    async function loadConfig() {
      try {
        const publicClientId = await getGoogleAuthConfig(controller.signal)
        if (!controller.signal.aborted) setClientId(publicClientId)
      } catch (error) {
        if (!controller.signal.aborted) {
          setVerificationStatus('error')
          setMessage({ type: 'service', value: error.message })
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingConfig(false)
      }
    }

    loadConfig()
    return () => controller.abort()
  }, [attempt])

  useEffect(() => {
    if (!clientId || scriptStatus !== 'loading') return

    const timeoutId = setTimeout(() => {
      setScriptStatus('error')
      setVerificationStatus('error')
      setMessage({ type: 'translation', key: 'buttonLoadError' })
    }, 15000)

    return () => clearTimeout(timeoutId)
  }, [clientId, scriptStatus])

  useEffect(() => {
    return () => verificationController.current?.abort()
  }, [])


  useEffect(() => {
    const controller = new AbortController()

    async function restoreSession() {
      try {
        // Consultamos si el navegador tiene una sesión válida.
        const user = await getCurrentUser(controller.signal)

        if (!controller.signal.aborted) {
          setSessionUser(user)
        }
      } catch {
        if (!controller.signal.aborted) {
          setVerificationStatus('error')
          setMessage({ type: 'translation', key: 'sessionCheckError' })
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsCheckingSession(false)
        }
      }
    }

    restoreSession()

    return () => controller.abort()
  }, [])

  function handleScriptError() {
    setScriptStatus('error')
    setVerificationStatus('error')
    setMessage({ type: 'translation', key: 'buttonLoadError' })
  }

  async function handleGoogleSuccess({ credential }) {
    if (verificationController.current) return

    const controller = new AbortController()
    verificationController.current = controller
    setVerificationStatus('verifying')
    setMessage({ type: 'translation', key: 'verifying' })

    try {
      const user= await loginWithGoogle(credential, controller.signal)

      if (!controller.signal.aborted) {
        setVerificationStatus('verified')
        setMessage({ type: 'translation', key: 'loginSuccess' })
        setSessionUser(user)

      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setVerificationStatus('error')
        setMessage({ type: 'service', value: error.message })
      }
    } finally {
      verificationController.current = null
    }
  }

  function handleGoogleError() {
    setVerificationStatus('error')
    setMessage({ type: 'translation', key: 'accessError' })
  }

  function handleGoogleClick() {
    // Google puede cerrar la ventana sin emitir un callback de cancelación.
    // Solo mostramos carga cuando tenemos una credencial para verificar.
    setVerificationStatus('idle')
    setMessage({ type: 'translation', key: 'popupNote' })
  }

  // Cierra la sesión desde React.
  async function handleLogout() {
    if (isLoggingOut) return

    setIsLoggingOut(true)
    setLogoutError(false)

    try {
      // Solicitamos a Deno invalidar la sesión.
      await logoutFromPokedex()

      // Indicamos a React quee ya no hay un usuario autenticado
      setSessionUser(null)

      // Volvemos al estado inicial del login.
      setVerificationStatus('idle')
      setMessage({ type: 'translation', key: 'logoutSuccess' })
      navigate('/', { replace: true }) //Volvemos al inicio, reemp la enrtrada actual del historial por inicio.
    } catch {
      // Si falla el servidor, mantenemos al usuario en pantalla.
      setLogoutError(true)
    } finally {
      setIsLoggingOut(false)
    }
  }

  function handleRetry() {
    setClientId('')
    setIsLoadingConfig(true)
    setScriptStatus('loading')
    setVerificationStatus('idle')
    setMessage(null)
    setAttempt(currentAttempt => currentAttempt + 1)
  }

  const isVerifying = verificationStatus === 'verifying'
  const canRetryConfig = !isLoadingConfig && (!clientId || scriptStatus === 'error')
  const translatedMessage = message?.type === 'service'
    ? texts.googleLogin.serviceError(message.value)
    : message
      ? texts.googleLogin[message.key]
      : ''

  // Mostramos un mensaje mientras comprobamos la sesión.
  if (isCheckingSession) {
    return (
      <section className="google-login">
        <p role="status">{texts.googleLogin.checkingSession}</p>
      </section>
    )
  }

  // Si hay una sesión válida, no mostramos el botón de Google.
  if (sessionUser) {
     return (
    <section className="google-login">
      <p role="status">
        {sessionUser.email
          ? texts.googleLogin.sessionStarted(sessionUser.email)
          : texts.googleLogin.sessionStartedDefault}
      </p>

      <button
        type="button"
        className="google-logout-button"
        onClick={handleLogout}
        disabled={isLoggingOut}
      >
        {isLoggingOut ? texts.googleLogin.loggingOut : texts.googleLogin.logout}
      </button>

      {logoutError && (
        <p role="alert" className="google-login-message--error">
          {texts.googleLogin.logoutError}
        </p>
      )}
    </section>
  )
}

  return (
    <section className="google-login" aria-label={texts.googleLogin.identityLabel}>
      {isLoadingConfig && <p role="status">{texts.googleLogin.loadingConfig}</p>}

      {clientId && scriptStatus !== 'error' && (
        <GoogleOAuthProvider
          key={language}
          clientId={clientId}
          locale={language}
          onScriptLoadSuccess={() => setScriptStatus('ready')}
          onScriptLoadError={handleScriptError}
        >
          {scriptStatus === 'loading' && <p role="status">{texts.googleLogin.loadingButton}</p>}
          <div hidden={scriptStatus !== 'ready' || isVerifying}>
            <GoogleLogin
              key={language}
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              click_listener={handleGoogleClick}
              text="signin_with"
              locale={language}
              size="large"
              width="240"
              ux_mode="popup"
              useOneTap={false}
              auto_select={false}
            />
          </div>
        </GoogleOAuthProvider>
      )}

      {message && (
        <p
          className={`google-login-message google-login-message--${verificationStatus}`}
          role={verificationStatus === 'error' ? 'alert' : 'status'}
        >
          {translatedMessage}
        </p>
      )}

      {canRetryConfig && (
        <button className="google-login-retry" type="button" onClick={handleRetry}>
          {texts.googleLogin.retry}
        </button>
      )}
      
      <p className="google-login-note">
        {texts.googleLogin.note}
      </p>

    </section>
  )
}

export default GoogleLoginButton
