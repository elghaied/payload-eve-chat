import { eveChannel } from 'eve/channels/eve'
import { type AuthFn } from 'eve/channels/auth'
import { authenticateAdmin } from '../../src/eve/auth'

const appAuth: AuthFn<Request> = async (request) => {
  const admin = await authenticateAdmin(request.headers)
  if (!admin) return null
  return {
    principalType: 'user',
    principalId: admin.id,
    authenticator: 'app',
    issuer: 'payload-eve-chat',
    attributes: {},
  }
}

export default eveChannel({ auth: [appAuth] })
