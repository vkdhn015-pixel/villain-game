import certifi
from pymongo import MongoClient

uri = "mongodb+srv://vkdhn015_db_user:GU3o1CglBCFRytYW@cluster0.atpzfga.mongodb.net/?retryWrites=true&w=majority"
client = MongoClient(uri, tlsCAFile=certifi.where())
print(client.admin.command("ping"))