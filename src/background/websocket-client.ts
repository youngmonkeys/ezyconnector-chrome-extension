import Ezy from 'ezyfox-es6-client';
import { ConnectionConfig, EzyRequestMessage, EzyResponseMessage } from './types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const ZONE_NAME = 'chat';
const APP_NAME = 'ezychat';
const CMD_CONNECTOR_REQUEST = 'connectorRequest';
const CMD_CONNECTOR_RESPONSE = 'connectorResponse';

export class EzyWebSocketClient {
  private readonly client: any;
  private app: any = null;
  private config: ConnectionConfig | null = null;

  constructor(
    private readonly onMessage: (message: EzyRequestMessage) => void,
    private readonly onStatusChange: (status: ConnectionStatus) => void,
  ) {
    this.client = this.createClient();
  }

  connect(config: ConnectionConfig): void {
    this.config = config;
    this.onStatusChange('connecting');
    this.client.connect(config.wsUrl);
  }

  disconnect(): void {
    this.app = null;
    this.client.disconnect();
    this.onStatusChange('disconnected');
  }

  send(message: EzyResponseMessage): void {
    if (this.app) {
      this.app.send(CMD_CONNECTOR_RESPONSE, message);
    }
  }

  private createClient(): any {
    const clientConfig = new Ezy.ClientConfig();
    clientConfig.zoneName = ZONE_NAME;
    clientConfig.reconnect.maxReconnectCount = 32768;

    const client = Ezy.Clients.getInstance().newClient(clientConfig);
    const { setup } = client;

    const connectionFailureHandler = new Ezy.ConnectionFailureHandler();
    connectionFailureHandler.postHandle = () => this.onStatusChange('error');

    const disconnectionHandler = new Ezy.DisconnectionHandler();
    disconnectionHandler.preHandle = () => {
      this.app = null;
      this.onStatusChange('disconnected');
    };

    const handshakeHandler = new Ezy.HandshakeHandler();
    handshakeHandler.getLoginRequest = () => {
      const username = 'useAccessToken';
      const password = 'useAccessToken';
      const data = { adminAccessToken: this.config?.token ?? '' };
      return [ZONE_NAME, username, password, data];
    };

    const loginErrorHandler = new Ezy.LoginErrorHandler();
    loginErrorHandler.handleLoginError = () => this.onStatusChange('error');

    const loginSuccessHandler = new Ezy.LoginSuccessHandler();
    loginSuccessHandler.handleLoginSuccess = () => {
      client.sendRequest(Ezy.Command.APP_ACCESS, [APP_NAME]);
    };

    const appAccessHandler = new Ezy.AppAccessHandler();
    appAccessHandler.postHandle = (app: unknown) => {
      this.app = app;
      this.onStatusChange('connected');
    };

    setup.addEventHandler(Ezy.EventType.CONNECTION_FAILURE, connectionFailureHandler);
    setup.addEventHandler(Ezy.EventType.DISCONNECTION, disconnectionHandler);
    setup.addDataHandler(Ezy.Command.HANDSHAKE, handshakeHandler);
    setup.addDataHandler(Ezy.Command.LOGIN, loginSuccessHandler);
    setup.addDataHandler(Ezy.Command.LOGIN_ERROR, loginErrorHandler);
    setup.addDataHandler(Ezy.Command.APP_ACCESS, appAccessHandler);

    setup.setupApp(APP_NAME).addDataHandler(
      CMD_CONNECTOR_REQUEST,
      (_app: unknown, data: EzyRequestMessage) => {
        if (data && typeof data.id === 'string' && typeof data.type === 'string') {
          this.onMessage(data);
        }
      },
    );

    return client;
  }
}
