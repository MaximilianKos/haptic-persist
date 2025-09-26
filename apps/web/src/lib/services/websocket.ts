interface WebSocketMessage {
	type: string;
	collection?: string;
	changeType?: 'created' | 'updated' | 'deleted';
	path?: string;
	timestamp?: string;
}

interface SubscriptionMessage {
	type: 'subscribe';
	collection: string;
}

export class WebSocketService {
	private ws: WebSocket | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private reconnectDelay = 1000;
	private subscribers: Map<string, (data: WebSocketMessage) => void> = new Map();

	constructor(private url: string) {}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.url);

				this.ws.onopen = () => {
					console.log('WebSocket connected');
					this.reconnectAttempts = 0;
					resolve();
				};

				this.ws.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data) as WebSocketMessage;
						this.handleMessage(data);
					} catch (error) {
						console.error('Error parsing WebSocket message:', error);
					}
				};

				this.ws.onclose = () => {
					console.log('WebSocket disconnected');
					this.handleReconnect();
				};

				this.ws.onerror = (error) => {
					console.error('WebSocket error:', error);
					reject(error);
				};
			} catch (error) {
				reject(error);
			}
		});
	}

	private handleMessage(data: WebSocketMessage) {
		this.subscribers.forEach((callback) => {
			callback(data);
		});
	}

	private handleReconnect() {
		if (this.reconnectAttempts < this.maxReconnectAttempts) {
			this.reconnectAttempts++;

			setTimeout(() => {
				this.connect().catch(console.error);
			}, this.reconnectDelay * this.reconnectAttempts);
		}
	}

	subscribe(id: string, callback: (data: WebSocketMessage) => void) {
		this.subscribers.set(id, callback);
	}

	unsubscribe(id: string) {
		this.subscribers.delete(id);
	}

	send(data: WebSocketMessage | SubscriptionMessage) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(data));
		}
	}

	subscribeToCollection(collection: string) {
		this.send({
			type: 'subscribe',
			collection
		});
	}

	disconnect() {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.subscribers.clear();
	}

	get isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}
}

// Singleton instance
export const webSocketService = new WebSocketService('ws://localhost:3000');
