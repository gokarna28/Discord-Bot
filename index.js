require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fetch = require('node-fetch');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');
const express = require('express');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Track bot instance
let isInitialized = false;

// Healthcheck endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        botStatus: client?.isReady() ? 'online' : 'starting',
        instance: isInitialized ? 'primary' : 'initializing'
    });
});

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel]
});

// QR code reading function
async function readQRCode(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        const buffer = await response.buffer();
        const image = await Jimp.read(buffer);

        // Enhance image for better QR code reading
        image
            .normalize() // Normalize the image
            .contrast(0.2) // Increase contrast slightly
            .quality(100); // Ensure highest quality

        // Try different scales if initial read fails
        const scales = [1, 1.5, 0.5]; // Try original size, larger, and smaller
        for (const scale of scales) {
            try {
                const scaledImage = image.clone().scale(scale);
                const result = await new Promise((resolve, reject) => {
                    const qr = new QrCode();
                    qr.callback = (err, value) => {
                        if (err) reject(err);
                        resolve(value?.result);
                    };
                    qr.decode(scaledImage.bitmap);
                });
                
                if (result) {
                    return result;
                }
            } catch (err) {
                console.log(`QR read attempt at scale ${scale} failed:`, err.message);
                continue; // Try next scale if this one fails
            }
        }
        
        throw new Error('Could not read QR code at any scale');
    } catch (error) {
        console.error('Error reading QR code:', error);
        if (error.message.includes('alignment patterns')) {
            throw new Error('QR code is not clear or properly aligned. Please ensure the image is clear and the QR code is not distorted.');
        } else if (error.message.includes('find finder')) {
            throw new Error('Could not locate QR code in image. Please ensure the QR code is clearly visible.');
        }
        throw new Error('Failed to process QR code. Please try again with a clearer image.');
    }
}

// Add retry logic helper function
async function fetchWithRetry(url, options = {}, maxRetries = 5, initialDelay = 1000) {
    let lastError;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response;
        } catch (error) {
            lastError = error;
            console.log(`Attempt #${attempt} failed: ${error.message}. ${attempt < maxRetries ? `Retrying in ${delay/1000}s...` : 'Max retries reached.'}`);
            
            if (attempt === maxRetries) {
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
        }
    }
    throw lastError;
}

// Modify the fetchQR1BeData function
async function fetchQR1BeData(url) {
    try {
        const response = await fetchWithRetry(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const html = await response.text();
        const info = {};

        // Extract name
        const nameMatch = html.match(/<(?:strong|h1|h2|div)[^>]*>([^<]+)<\/(?:strong|h1|h2|div)>/);
        if (nameMatch) info.name = nameMatch[1].trim();

        // Extract phone
        const phoneMatch = html.match(/(?:tel:|Phone:|phone:)[^\d]*(\d[\d\s-]{8,})/);
        if (phoneMatch) info.phone = phoneMatch[1].replace(/\D/g, '');

        // Extract email
        const emailMatch = html.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) info.email = emailMatch[1].trim();

        return info.email ? info : null;
    } catch (error) {
        console.error('Error fetching qr1.be data:', error);
        throw new Error('Failed to fetch contact information after multiple retries');
    }
}

// Modify the verifySmallStreetMembership function
async function verifySmallStreetMembership(email) {
    try {
        const response = await fetchWithRetry('https://www.smallstreet.app/wp-json/myapi/v1/api');
        const data = await response.json();
        
        for (const user of data) {
            if (user.user_email.toLowerCase() === email.toLowerCase() && user.membership_id) {
                return [true, user.membership_name];
            }
        }
        return [false, null];
    } catch (error) {
        console.error('Error verifying membership:', error);
        throw new Error('Failed to verify membership after multiple retries');
    }
}

// Assign role based on membership
async function assignRoleBasedOnMembership(member, membershipType) {
    try {
        const MEGAVOTER_ROLE_ID = process.env.MEGAVOTER_ROLE_ID;
        const PATRON_ROLE_ID = process.env.PATRON_ROLE_ID;

        // Remove existing roles
        [MEGAVOTER_ROLE_ID, PATRON_ROLE_ID].forEach(async (roleId) => {
            const role = member.guild.roles.cache.get(roleId);
            if (role && member.roles.cache.has(roleId)) {
                await member.roles.remove(role);
            }
        });

        // Assign new role
        if (membershipType.toLowerCase() === 'pioneer') {
            const role = member.guild.roles.cache.get(MEGAVOTER_ROLE_ID);
            if (role) {
                await member.roles.add(role);
                return "MEGAvoter";
            }
        } else if (membershipType.toLowerCase() === 'patron') {
            const role = member.guild.roles.cache.get(PATRON_ROLE_ID);
            if (role) {
                await member.roles.add(role);
                return "Patron";
            }
        }
        return null;
    } catch (error) {
        console.error('Error assigning role:', error);
        return null;
    }
}

// Bot ready event
client.once('ready', async () => {
    if (isInitialized) {
        console.log('Preventing duplicate initialization');
        return;
    }
    
    isInitialized = true;
    console.log(`Bot is online as ${client.user.tag}`);
    
    try {
        // Clear any existing bot messages in the verification channel
        const channel = client.channels.cache.get(process.env.VERIFY_CHANNEL_ID);
        if (channel) {
            // Fetch recent messages
            const messages = await channel.messages.fetch({ limit: 100 });
            const botMessages = messages.filter(msg => 
                msg.author.id === client.user.id && 
                (msg.content.includes('Bot is online') || msg.content.includes('Make Everyone Great Again'))
            );
            
            // Delete old bot messages
            if (botMessages.size > 0) {
                await channel.bulkDelete(botMessages).catch(console.error);
            }
            
            // Send new startup message
            await channel.send('🤖 Bot is online and ready to process QR codes!\nMake Everyone Great Again');
        }
    } catch (error) {
        console.error('Error during startup cleanup:', error);
    }
});

// Start Express server only once
let server;
if (!server) {
    server = app.listen(PORT, () => {
        console.log(`Health check server is running on port ${PORT}`);
    });
}

// Add graceful shutdown handling
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal. Cleaning up...');
    try {
        if (server) {
            server.close();
        }
        if (client) {
            const channel = client.channels.cache.get(process.env.VERIFY_CHANNEL_ID);
            if (channel) {
                await channel.send('⚠️ Bot is restarting for maintenance. Please wait a moment...\nMake Everyone Great Again');
            }
            client.destroy();
        }
    } catch (error) {
        console.error('Error during shutdown:', error);
    } finally {
        process.exit(0);
    }
});

process.on('SIGINT', async () => {
    console.log('Received SIGINT signal. Cleaning up...');
    try {
        const channel = client.channels.cache.get(process.env.VERIFY_CHANNEL_ID);
        if (channel) {
            await channel.send('⚠️ Bot is shutting down. Please wait a moment...');
        }
    } catch (error) {
        console.error('Error during shutdown:', error);
    } finally {
        // Destroy the client connection
        client.destroy();
        process.exit(0);
    }
});

// Add a Set to track processing messages
const processingUsers = new Set();

// Message handling
client.on('messageCreate', async (message) => {
    // Basic checks
    if (message.author.bot || 
        message.channel.id !== process.env.VERIFY_CHANNEL_ID || 
        !message.attachments.size) return;

    // Process image
    const attachment = message.attachments.first();
    if (!attachment.name.match(/\.(png|jpg|jpeg)$/i)) {
        await message.reply({ 
            content: `❌ Please send a valid image file (PNG, JPG, or JPEG).`,
            ephemeral: true 
        });
        return;
    }

    // Create a unique lock key for this verification attempt
    const lockKey = `verification_${message.author.id}`;
    if (processingUsers.has(lockKey)) {
        await message.reply({ 
            content: '⚠️ Please wait for your current verification to complete.',
            ephemeral: true 
        });
        return;
    }

    try {
        // Add verification to processing set
        processingUsers.add(lockKey);
        
        // Send initial processing message
        await message.reply({ 
            content: `🔍 Processing QR code...`,
            ephemeral: true 
        });

        // First, just try to read the QR code before making any API calls
        const qrData = await readQRCode(attachment.url);
        if (!qrData) {
            await message.reply({ 
                content: `❌ Could not read QR code. Please ensure the image is clear and try again.`,
                ephemeral: true 
            });
            return;
        }

        // Verify it's a qr1.be URL before proceeding with API calls
        if (!qrData.includes('qr1.be')) {
            await message.reply({ 
                content: `❌ Invalid QR code. Must be from qr1.be`,
                ephemeral: true 
            });
            return;
        }

        // Now we know we have a valid QR code, proceed with API calls
        await message.reply({ 
            content: `🔍 Reading contact information...`,
            ephemeral: true 
        });

        const contactInfo = await fetchQR1BeData(qrData);
        if (!contactInfo || !contactInfo.email) {
            await message.reply({ 
                content: `❌ Could not read contact information. Please try again.`,
                ephemeral: true 
            });
            return;
        }

        await message.reply({ 
            content: `🔍 Verifying membership...`,
            ephemeral: true 
        });

        const [isMember, membershipType] = await verifySmallStreetMembership(contactInfo.email);
        if (!isMember || !membershipType) {
            await message.reply({ 
                content: `❌ User not verified!\nPlease register and purchase a membership at https://www.smallstreet.app/login/ first.`,
                ephemeral: true 
            });
            return;
        }

        // Only try to assign role if membership is verified
        const roleName = await assignRoleBasedOnMembership(message.member, membershipType);

        // Prepare success response
        const response = [
            `✅ Verified SmallStreet Membership - ${membershipType}`,
            roleName ? `🎭 Discord Role Assigned: ${roleName}` : '',
            '📇 Contact Information:',
            `👤 Name: ${contactInfo.name || 'N/A'}`,
            `📱 Phone: ${contactInfo.phone || 'N/A'}`,
            `📧 Email: ${contactInfo.email}`
        ].filter(Boolean);

        // Send final verification result
        await message.reply({ 
            content: response.join('\n'),
            ephemeral: true 
        });

    } catch (error) {
        console.error('Error during verification:', error);
        const errorMessage = error.message || 'undefined';
        await message.reply({ 
            content: `❌ An error occurred: ${errorMessage}`,
            ephemeral: true 
        });
    } finally {
        // Always clean up
        processingUsers.delete(lockKey);
    }
});

// Only login if not already initialized
if (!isInitialized) {
    client.login(process.env.DISCORD_TOKEN);
} 