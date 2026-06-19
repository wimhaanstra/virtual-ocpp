# Virtual OCPP

I want to build a Virtual OCPP service that allows users to connect their OCPP 1.6j (minimum) charger to via a websocket. It will give the user insight in the charging sessions that are started and stopped, etc.

But it will also include an OCPP Proxy, allowing charging sessions to be mirrored to external backends like Tap Electric, Joulo, or E-Flux, which accept websocket connections with those details as well. Proxy targets should be configurable without a hard-coded limit.

- In our case we will be using a Smart EVSE charging station to test connections.
- We want configurable that external sources are able to deny charging. This happens when you connect the Joulo OCPP Proxy to our Smart EVSE charging station and something is wrong in the connection.
- We should be able to read the UUID of the tag that is used (in the OCPP transmissions) and see if it matches on of our tags. If it does, charging CAN be enabled, otherwise we deny access.

# Architecture
- Backend, (written in node typescript) that makes sure the Smart EVSE can continuesly be connected.
- Frontend, written in React Typescript, should use React components
- Use https://ui.shadcn.com/ for a UI framework for the frontend
- SQL lite database to store charging sessions, tag, etc
- Logs when connections to other OCPP services are disconnected etc.
- Home dashboard with charger connection information and current connection state.
- OCPP charger simulator for development, demos, and deployment smoke tests.
- Deployable to a docker image which we will publish to docker hub later.

Joulo OCPP Proxy Source code: https://github.com/joulo-nl/joulo-ocpp-proxy
