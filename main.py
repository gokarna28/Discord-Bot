import discord
from discord.ext import commands
from dotenv import load_dotenv
import os
import logging
from PIL import Image
import cv2
import numpy as np
import io
import aiohttp
import re
import asyncio

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')
VERIFY_CHANNEL_ID = int(os.getenv('VERIFY_CHANNEL_ID'))

# Role IDs
MEGAVOTER_ROLE_ID = 1374722300372455534
PATRON_ROLE_ID = 1374722530622832802

# Set up bot
intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.members = True
bot = commands.Bot(command_prefix='!', intents=intents)

# Track processed messages and lock
processed_messages = set()
message_lock = asyncio.Lock()

async def read_qr_code(image_url):
    """Read QR code from image using OpenCV"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(image_url) as response:
                if response.status == 200:
                    # Read image data
                    image_data = await response.read()
                    
                    # Convert to OpenCV format
                    nparr = np.frombuffer(image_data, np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
                    
                    # Initialize QR Code detector
                    qr_detector = cv2.QRCodeDetector()
                    
                    # Detect and decode QR code
                    data, bbox, _ = qr_detector.detectAndDecode(img)
                    
                    return data if data else None
    except Exception as e:
        logger.error(f"Error reading QR code: {e}")
        return None

async def fetch_qr1be_data(url):
    """Fetch contact information from qr1.be URL"""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    html = await response.text()
                    info = {}
                    
                    # Extract name
                    name_match = re.search(r'<(?:strong|h1|h2|div)[^>]*>([^<]+)</(?:strong|h1|h2|div)>', html)
                    if name_match:
                        info['name'] = name_match.group(1).strip()
                    
                    # Extract phone
                    phone_match = re.search(r'(?:tel:|Phone:|phone:)[^\d]*(\d[\d\s-]{8,})', html)
                    if phone_match:
                        info['phone'] = ''.join(filter(str.isdigit, phone_match.group(1)))
                    
                    # Extract email
                    email_match = re.search(r'([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', html)
                    if email_match:
                        info['email'] = email_match.group(1).strip()
                    
                    return info if info.get('email') else None
    except Exception as e:
        logger.error(f"Error fetching qr1.be data: {e}")
        return None

async def verify_smallstreet_membership(email):
    """Verify if email exists in SmallStreet API"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get('https://www.smallstreet.app/wp-json/myapi/v1/api') as response:
                if response.status == 200:
                    data = await response.json()
                    for user in data:
                        if user['user_email'].lower() == email.lower() and user['membership_id']:
                            return True, user['membership_name']
                    return False, None
    except Exception as e:
        logger.error(f"Error verifying membership: {e}")
        return False, None

async def assign_role_based_on_membership(member, membership_type):
    """Assign appropriate Discord role"""
    try:
        # Remove existing roles
        for role_id in [MEGAVOTER_ROLE_ID, PATRON_ROLE_ID]:
            role = member.guild.get_role(role_id)
            if role and role in member.roles:
                await member.remove_roles(role)
        
        # Assign new role
        if membership_type.lower() == 'pioneer':
            role = member.guild.get_role(MEGAVOTER_ROLE_ID)
            if role:
                await member.add_roles(role)
                return "MEGAvoter"
        elif membership_type.lower() == 'patron':
            role = member.guild.get_role(PATRON_ROLE_ID)
            if role:
                await member.add_roles(role)
                return "Patron"
    except Exception as e:
        logger.error(f"Error assigning role: {e}")
    return None

@bot.event
async def on_ready():
    """Bot startup"""
    logger.info(f'Bot connected as {bot.user.name}')
    channel = bot.get_channel(VERIFY_CHANNEL_ID)
    if channel:
        await channel.send('🤖 Bot is online and ready to process QR codes!')

@bot.listen('on_message')
async def handle_message(message):
    """Handle incoming messages"""
    # Basic checks
    if message.author.bot or message.channel.id != VERIFY_CHANNEL_ID or not message.attachments:
        return

    # Process image
    attachment = message.attachments[0]
    if not attachment.filename.lower().endswith(('.png', '.jpg', '.jpeg')):
        return

    # Send initial message
    processing_msg = await message.channel.send('🔍 Processing your QR code...')

    try:
        # Read QR code
        qr_data = await read_qr_code(attachment.url)
        if not qr_data:
            await processing_msg.edit(content="❌ Could not read QR code. Please ensure image is clear.")
            return

        # Verify qr1.be URL
        if 'qr1.be' not in qr_data:
            await processing_msg.edit(content="❌ Invalid QR code. Must be from qr1.be")
            return

        # Get contact info
        await processing_msg.edit(content="🔍 Reading contact information...")
        contact_info = await fetch_qr1be_data(qr_data)
        if not contact_info:
            await processing_msg.edit(content="❌ Could not read contact information")
            return

        # Verify membership
        await processing_msg.edit(content="🔍 Verifying membership...")
        is_member, membership_type = await verify_smallstreet_membership(contact_info['email'])
        if not is_member:
            await processing_msg.edit(content="❌ Not a SmallStreet member")
            return

        # Assign role
        role_name = await assign_role_based_on_membership(message.author, membership_type)
        
        # Prepare response
        response = [
            f"✅ Verified SmallStreet Membership - {membership_type}",
            f"🎭 Discord Role Assigned: {role_name}" if role_name else "",
            "📇 Contact Information:",
            f"👤 Name: {contact_info.get('name', 'N/A')}",
            f"📱 Phone: {contact_info.get('phone', 'N/A')}",
            f"📧 Email: {contact_info['email']}"
        ]
        
        await processing_msg.edit(content='\n'.join(filter(None, response)))

    except Exception as e:
        logger.error(f"Error processing message: {e}")
        await processing_msg.edit(content=f"❌ An error occurred: {str(e)}")

# Run bot
bot.run(TOKEN)
