require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fetch = require('node-fetch');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');

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
        
        return new Promise((resolve, reject) => {
            const qr = new QrCode();
            qr.callback = (err, value) => {
                if (err) reject(err);
                resolve(value?.result);
            };
            qr.decode(image.bitmap);
        });
    } catch (error) {
        console.error('Error reading QR code:', error);
        return null;
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
client.once('ready', () => {
    console.log(`Bot is online as ${client.user.tag}`);
    const channel = client.channels.cache.get(process.env.VERIFY_CHANNEL_ID);
    if (channel) {
        channel.send('🤖 Bot is online and ready to process QR codes!');
    }
});

// Message handling
client.on('messageCreate', async (message) => {
    // Basic checks
    if (message.author.bot || 
        message.channel.id !== process.env.VERIFY_CHANNEL_ID || 
        !message.attachments.size) return;

    // Process image
    const attachment = message.attachments.first();
    if (!attachment.name.match(/\.(png|jpg|jpeg)$/i)) {
        await message.channel.send(`❌ Please send a valid image file (PNG, JPG, or JPEG), ${message.author}.`);
        return;
    }

    // Check for recent verification attempts by this user
    const recentMessages = await message.channel.messages.fetch({ limit: 10 });
    const hasRecentVerification = recentMessages.some(msg => 
        msg.author.bot && 
        msg.mentions.users.has(message.author.id) &&
        Date.now() - msg.createdTimestamp < 5000
    );

    if (hasRecentVerification) {
        await message.channel.send(`⚠️ Please wait a few seconds before trying again, ${message.author}.`);
        return; // Prevent duplicate processing
    }

    const processingMsg = await message.channel.send(`🔍 Processing QR code for ${message.author}...`);

    try {
        // First, just try to read the QR code before making any API calls
        const qrData = await readQRCode(attachment.url);
        if (!qrData) {
            await processingMsg.edit(`❌ Could not read QR code. Please ensure image is clear and try again, ${message.author}.`);
            return;
        }

        // Verify it's a qr1.be URL before proceeding with API calls
        if (!qrData.includes('qr1.be')) {
            await processingMsg.edit(`❌ Invalid QR code. Must be from qr1.be, ${message.author}.`);
            return;
        }

        try {
            // Now we know we have a valid QR code, proceed with API calls
            await processingMsg.edit(`🔍 Reading contact information... (This may take a moment)`);
            const contactInfo = await fetchQR1BeData(qrData);
            if (!contactInfo || !contactInfo.email) {
                await processingMsg.edit(`❌ Could not read contact information from QR code, ${message.author}. Please try again.`);
                return;
            }

            await processingMsg.edit(`🔍 Verifying membership... (This may take a moment)`);
            const [isMember, membershipType] = await verifySmallStreetMembership(contactInfo.email);
            if (!isMember || !membershipType) {
                await processingMsg.edit(`❌ Not a verified SmallStreet member, ${message.author}. Please register at https://www.smallstreet.app/login/`);
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

            await processingMsg.edit(response.join('\n'));

        } catch (error) {
            console.error('API Error:', error);
            if (error.message.includes('multiple retries')) {
                await processingMsg.edit(`❌ Service is temporarily unavailable, ${message.author}. Please try again in a few minutes.`);
            } else {
                await processingMsg.edit(`❌ An error occurred during verification, ${message.author}. Please try again.`);
            }
        }
    } catch (error) {
        console.error('QR Processing Error:', error);
        await processingMsg.edit(`❌ Failed to process the QR code, ${message.author}. Please try again with a clearer image.`);
    }
});

// Login
client.login(process.env.DISCORD_TOKEN); 