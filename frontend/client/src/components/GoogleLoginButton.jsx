import { useEffect, useRef, useState } from 'react'
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'
import { getGoogleAuthConfig, loginWithGoogle, getCurrentUser } from '../services/authService'
import './GoogleLoginButton.css'

function GoogleLoginButton() {
  const [clientId, setClientId] = useState('')
  const [isLoadingConfig, setIsLoadingConfig] = useState(true)
  const [scriptStatus, setScriptStatus] = useState('loading')
  const [verificationStatus, setVerificationStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const verificationController = useRef(null)
  const [sessionUser, setSessionUser] = useState(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    async function loadConfig() {
      try {
        const publicClientId = await getGoogleAuthConfig(controller.signal)
        if (!controller.signal.aborted) setClientId(publicClientId)
      } catch (error) {
        if (!controller.signal.aborted) {
          setVerificationStatus('error')
          setMessage(error.message)
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
      setMessage('No se pudo cargar el botón de Google. Revisa tu conexión o los bloqueadores del navegador.')
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
          setMessage('No se pudo comprobar la sesión.')
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
    setMessage('No se pudo cargar el botón de Google. Revisa tu conexión o los bloqueadores del navegador.')
  }

  async function handleGoogleSuccess({ credential }) {
    if (verificationController.current) return

    const controller = new AbortController()
    verificationController.current = controller
    setVerificationStatus('verifying')
    setMessage('Verificando tu identidad con el servidor…')

    try {
      const user= await loginWithGoogle(credential, controller.signal)

      if (!controller.signal.aborted) {
        setVerificationStatus('verified')
        setMessage('Sesión creada correctamente con Google.')
        setSessionUser(user)

      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setVerificationStatus('error')
        setMessage(error.message)
      }
    } finally {
      verificationController.current = null
    }
  }

  function handleGoogleError() {
    setVerificationStatus('error')
    setMessage('No se completó el acceso con Google. Vuelve a intentarlo y comprueba que este sitio esté autorizado en la configuración de Google.')
  }

  function handleGoogleClick() {
    // Google puede cerrar la ventana sin emitir un callback de cancelación.
    // Solo mostramos carga cuando tenemos una credencial para verificar.
    setVerificationStatus('idle')
    setMessage('Si cancelas o cierras la ventana de Google, puedes volver a intentarlo con el botón.')
  }

  function handleRetry() {
    setClientId('')
    setIsLoadingConfig(true)
    setScriptStatus('loading')
    setVerificationStatus('idle')
    setMessage('')
    setAttempt(currentAttempt => currentAttempt + 1)
  }

  const isVerifying = verificationStatus === 'verifying'
  const canRetryConfig = !isLoadingConfig && (!clientId || scriptStatus === 'error')

  // Mostramos un mensaje mientras comprobamos la sesión.
  if (isCheckingSession) {
    return (
      <section className="google-login">
        <p role="status">Comprobando sesión...</p>
      </section>
    )
  }

  // Si hay una sesión válida, no mostramos el botón de Google.
  if (sessionUser) {
    return (
      <section className="google-login">
        <p role="status">
          Sesión iniciada
          {sessionUser.email
            ? ` con ${sessionUser.email}`
            : ' correctamente'}.
        </p>
        <p className="google-login-note">
          Continúa con Google para iniciar sesión en tu Pokédex.
        </p>
      </section>
    )
  }

  return (
    <section className="google-login" aria-label="Verificación de identidad con Google">
      {isLoadingConfig && <p role="status">Cargando configuración de Google…</p>}

      {clientId && scriptStatus !== 'error' && (
        <GoogleOAuthProvider
          clientId={clientId}
          locale="es"
          onScriptLoadSuccess={() => setScriptStatus('ready')}
          onScriptLoadError={handleScriptError}
        >
          {scriptStatus === 'loading' && <p role="status">Cargando botón de Google…</p>}
          <div hidden={scriptStatus !== 'ready' || isVerifying}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              click_listener={handleGoogleClick}
              text="signin_with"
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
          {message}
        </p>
      )}

      {canRetryConfig && (
        <button className="google-login-retry" type="button" onClick={handleRetry}>
          Reintentar
        </button>
      )}
      
      <p className="google-login-note">
        Tu sesión se ha creado correctamente.
        Próximamente podrás mantenerla al recargar la página.
      </p>

    </section>
  )
}

export default GoogleLoginButton
