import {
    Context,
    createConnector,
    readConfig,
    Response,
    logger,
    StdTestConnectionOutput,
    StdTestConnectionInput,
    StdEntitlementListInput,
    StdEntitlementListOutput,
    ConnectorError,
    SimpleKey,
} from '@sailpoint/connector-sdk'
import { IscClient } from './isc-client'

import { Config } from './models/config'

// Connector must be exported as module property named connector
export const connector = async () => {
    // Get connector source config
    const config = await readConfig()

    if (!config) {
        throw new ConnectorError('Connector configuration is missing')
    }

    // Print configuration with masked secrets
    const configWrapper = new Config(config)
    configWrapper.print()

    logger.info('Config loaded successfully')

    // Initialize ISC Client
    const iscClient = new IscClient(config)

    return createConnector()
        .stdTestConnection(
            async (context: Context, input: StdTestConnectionInput, res: Response<StdTestConnectionOutput>) => {
                logger.info('Running test connection')
                // logger.info("Config: ", config) // Removed raw config logging
                logger.info('ISC Client initialized')
                res.send(await iscClient.testConnection())
            }
        )
        .stdEntitlementList(
            async (context: Context, input: StdEntitlementListInput, res: Response<StdEntitlementListOutput>) => {
                logger.info('Running entitlement list (Sync Mode - Streaming)')

                // Set up keep-alive logic
                const KEEP_ALIVE_INTERVAL = 30000 // 30 seconds
                let lastKeepAlive = Date.now()

                const sendKeepAliveIfNeeded = () => {
                    const now = Date.now()
                    if (now - lastKeepAlive > KEEP_ALIVE_INTERVAL) {
                        res.keepAlive()
                        logger.info('Sent keep-alive message to prevent timeout')
                        lastKeepAlive = now
                    }
                }

                // Start sending keep-alive immediately
                sendKeepAliveIfNeeded()

                let count = 0

                // Iterate over the stream of entitlements
                // The generator handles fetching pages and syncing to targets
                // We handle sending responses and keep-alive here
                for await (const ent of iscClient.streamEntitlements()) {
                    // Send keep-alive if needed
                    sendKeepAliveIfNeeded()

                    res.send({
                        key: SimpleKey(`SaaS_${ent.value || ent.id}`),
                        type: ent.attribute || 'group',
                        attributes: {
                            id: ent.id,
                            name: ent.name,
                            displayName: ent.displayName || ent.name,
                            description: ent.description,
                            value: `SaaS_${ent.value}`,
                            ...ent.attributes,
                        },
                    })
                    count++

                    // Log progress every 50 entitlements
                    if (count > 0 && count % 50 === 0) {
                        logger.info(`Sent ${count} entitlements to SailPoint...`)
                    }
                }

                logger.info(`stdEntitlementList completed. Sent ${count} entitlements.`)
            }
        )
}
