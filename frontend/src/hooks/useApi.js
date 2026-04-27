import { useState, useEffect, useCallback, useRef } from 'react'

const useApi = (fetchFn, deps = []) => {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const abortRef = useRef(null)

  const execute = useCallback(async () => {
    // Abort any in-flight request before starting a new one
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    try {
      const res = await fetchFn()
      if (!controller.signal.aborted) setData(res.data)
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err.response?.data?.message || 'Something went wrong')
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    execute()
    return () => { if (abortRef.current) abortRef.current.abort() }
  }, [execute])

  return { data, loading, error, refetch: execute }
}

export default useApi
